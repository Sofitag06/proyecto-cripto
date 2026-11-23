const hre = require("hardhat");
const fs = require("fs");
const path = require("path");

async function esperarNodo() {
  for (let i = 0; i < 60; i++) {
    try { await hre.ethers.provider.getBlockNumber(); return; }
    catch { await new Promise(r => setTimeout(r, 1000)); }
  }
  throw new Error("El nodo de Hardhat no respondió");
}

async function main() {
  await esperarNodo();
  const signers = await hre.ethers.getSigners();

  const Banco = await hre.ethers.getContractFactory("Banco");
  const banco = await Banco.deploy();
  await banco.waitForDeployment();
  const direccion = await banco.getAddress();

  // Víctimas (cuentas 1, 2 y 3) depositan 10 ETH en total
  const depositos = [[1, "3"], [2, "3"], [3, "4"]];
  for (const [i, monto] of depositos) {
    const tx = await banco.connect(signers[i]).depositar({ value: hre.ethers.parseEther(monto) });
    await tx.wait();
  }

  const bancoArt = await hre.artifacts.readArtifact("Banco");
  const atacanteArt = await hre.artifacts.readArtifact("Atacante");
  const salida = {
    banco: { address: direccion, abi: bancoArt.abi },
    atacante: { abi: atacanteArt.abi, bytecode: atacanteArt.bytecode }
  };

  const destino = process.env.DEPLOYED || "/shared/deployed.json";
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, JSON.stringify(salida, null, 2));
  console.log(`Banco desplegado en ${direccion}`);
  console.log("Banco cargado con 10 ETH de víctimas");
}

main().catch(e => { console.error(e); process.exit(1); });
