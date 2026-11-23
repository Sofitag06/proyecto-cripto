// Backend del Banco: mismo código para la versión vulnerable y la mitigada.
// Lo único que cambia es el contrato que despliega cada nodo (variable MODO solo para mostrar).
const express = require("express");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const MODO = process.env.MODO || "vulnerable";
const PORT = process.env.PORT || 3000;
const DEPLOYED = process.env.DEPLOYED || "/shared/deployed.json";

// Cuentas de prueba de Hardhat
const CUENTAS = { victima1: 1, victima2: 2, victima3: 3, atacante: 9 };

const provider = new ethers.JsonRpcProvider(RPC_URL);
const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const eth = (wei) => ethers.formatEther(wei);

function leerDeploy() {
  if (!fs.existsSync(DEPLOYED)) {
    throw new Error("El contrato todavía no está desplegado, espera unos segundos");
  }
  return JSON.parse(fs.readFileSync(DEPLOYED, "utf8"));
}

function banco(runner) {
  const d = leerDeploy();
  return new ethers.Contract(d.banco.address, d.banco.abi, runner || provider);
}

async function signerDe(cuenta) {
  if (!(cuenta in CUENTAS)) throw new Error(`Cuenta desconocida: ${cuenta}`);
  return provider.getSigner(CUENTAS[cuenta]);
}

const ruta = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(400).json({ error: e.shortMessage || e.reason || e.message }); }
};

app.get("/info", (req, res) => res.json({ modo: MODO }));

app.get("/estado", ruta(async () => {
  const d = leerDeploy();
  const b = banco();
  const cuentas = {};
  for (const nombre of Object.keys(CUENTAS)) {
    const direccion = await (await signerDe(nombre)).getAddress();
    cuentas[nombre] = {
      direccion,
      billetera: eth(await provider.getBalance(direccion)),
      saldoEnBanco: eth(await b.saldos(direccion))
    };
  }
  return { modo: MODO, banco: d.banco.address, balanceBanco: eth(await b.balanceContrato()), cuentas };
}));

app.post("/depositar", ruta(async (req) => {
  const { cuenta, monto } = req.body;
  const signer = await signerDe(cuenta);
  const tx = await banco(signer).depositar({ value: ethers.parseEther(String(monto || "1")) });
  await tx.wait();
  return { ok: true, mensaje: `${cuenta} depositó ${monto || 1} ETH`, tx: tx.hash };
}));

app.post("/retirar", ruta(async (req) => {
  const { cuenta } = req.body;
  const signer = await signerDe(cuenta);
  const tx = await banco(signer).retirar();
  await tx.wait();
  return { ok: true, mensaje: `${cuenta} retiró su saldo`, tx: tx.hash };
}));

// Despliega un contrato Atacante y lanza el ataque de reentrancy
app.post("/atacar", ruta(async () => {
  const d = leerDeploy();
  const b = banco();
  const signer = await signerDe("atacante");
  const antes = await b.balanceContrato();

  const fabrica = new ethers.ContractFactory(d.atacante.abi, d.atacante.bytecode, signer);
  const atacante = await fabrica.deploy(d.banco.address);
  await atacante.waitForDeployment();
  const dirAtacante = await atacante.getAddress();

  let exito = false;
  let error = null;
  try {
    const tx = await atacante.atacar({ value: ethers.parseEther("1"), gasLimit: 3_000_000 });
    await tx.wait();
    exito = true;
  } catch (e) {
    // Repetir la llamada en modo simulación para obtener el motivo del revert
    try {
      await atacante.atacar.staticCall({ value: ethers.parseEther("1"), gasLimit: 3_000_000 });
      error = e.shortMessage || e.message;
    } catch (e2) {
      error = e2.reason || e2.shortMessage || "La transacción fue revertida";
    }
  }

  const despues = await b.balanceContrato();
  const botin = await provider.getBalance(dirAtacante);
  if (botin > 0n) {
    await (await atacante.retirarBotin()).wait();
  }

  return {
    modo: MODO,
    exito: exito && despues < antes,
    balanceBancoAntes: eth(antes),
    balanceBancoDespues: eth(despues),
    robado: eth(botin > ethers.parseEther("1") ? botin - ethers.parseEther("1") : 0n),
    contratoAtacante: dirAtacante,
    mensaje: exito && despues < antes
      ? `Ataque exitoso: el banco pasó de ${eth(antes)} a ${eth(despues)} ETH`
      : `Ataque bloqueado: el banco sigue con ${eth(despues)} ETH`,
    error
  };
}));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend [${MODO}] escuchando en el puerto ${PORT}, nodo: ${RPC_URL}`);
});
