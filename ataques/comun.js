// Configuración compartida de los scripts de ataque
const { ethers } = require("ethers");

const HOST = process.env.HOST || "localhost";
const OBJETIVOS = {
  vulnerable: { api: `http://${HOST}:3001`, rpc: `http://${HOST}:8545` },
  mitigada:   { api: `http://${HOST}:3002`, rpc: `http://${HOST}:8546` }
};

async function conectar(modo) {
  const o = OBJETIVOS[modo];
  if (!o) {
    console.error("Uso: node <script>.js vulnerable|mitigada");
    process.exit(1);
  }
  const provider = new ethers.JsonRpcProvider(o.rpc, undefined, { cacheTimeout: -1 });
  // Cuenta #9 de Hardhat = el atacante (llave derivada del mnemónico público de Hardhat)
  const atacante = ethers.HDNodeWallet
    .fromPhrase("test test test test test test test test test test test junk", "", "m/44'/60'/0'/0/9")
    .connect(provider);
  // El atacante solo necesita la dirección y el ABI del banco (información pública)
  const info = await (await fetch(`${o.api}/contrato`)).json();
  if (info.error) throw new Error(info.error);
  const banco = new ethers.Contract(info.banco.address, info.banco.abi, atacante);
  return { provider, atacante, banco, info };
}

const eth = (wei) => ethers.formatEther(wei);
const motivo = (e) => e.reason || (e.revert && e.revert.name) || e.shortMessage || e.message;

module.exports = { conectar, eth, motivo, ethers };
