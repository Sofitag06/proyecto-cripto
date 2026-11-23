const { ethers } = require("hardhat");

// Orden de la curva secp256k1 (para fabricar la firma "maleable" s' = n - s)
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;

async function desplegar() {
  const [deployer, v1, v2, v3, destinatario, , , , , atacanteEOA] = await ethers.getSigners();
  const Banco = await ethers.getContractFactory("Banco");
  const banco = await Banco.deploy();
  for (const [s, m] of [[v1, "3"], [v2, "3"], [v3, "4"]]) {
    await banco.connect(s).depositar(ethers.ZeroHash, { value: ethers.parseEther(m) });
  }
  return { banco, deployer, v1, v2, v3, destinatario, atacanteEOA };
}

// Firma EIP-191 (personal_sign) de (titular, destinatario, monto) — esquema VULNERABLE
async function firmarSimple(titular, destinatario, monto) {
  const hash = ethers.solidityPackedKeccak256(["address", "address", "uint256"], [titular.address, destinatario, monto]);
  return titular.signMessage(ethers.getBytes(hash));
}

// Firma EIP-712 — esquema MITIGADO
async function firmarEIP712(banco, titular, destinatario, monto, deadline) {
  const { chainId } = await ethers.provider.getNetwork();
  const domain = { name: "BancoCripto", version: "1", chainId, verifyingContract: await banco.getAddress() };
  const types = { Pago: [
    { name: "titular", type: "address" }, { name: "destinatario", type: "address" },
    { name: "monto", type: "uint256" }, { name: "nonce", type: "uint256" }, { name: "deadline", type: "uint256" }
  ] };
  const nonce = await banco.nonces(titular.address);
  return titular.signTypedData(domain, types, { titular: titular.address, destinatario, monto, nonce, deadline });
}

function malear(firma) {
  const sig = ethers.Signature.from(firma);
  const s2 = N - BigInt(sig.s);
  const v2 = sig.v === 27 ? 28 : 27;
  return ethers.concat([sig.r, ethers.zeroPadValue(ethers.toBeHex(s2), 32), ethers.toBeHex(v2, 1)]);
}

module.exports = { desplegar, firmarSimple, firmarEIP712, malear };
