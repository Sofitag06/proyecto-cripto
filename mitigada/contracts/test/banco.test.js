const { expect } = require("chai");
const { ethers } = require("hardhat");
const { time } = require("@nomicfoundation/hardhat-network-helpers");
const { desplegar, firmarSimple, firmarEIP712, malear } = require("./helpers");

const ETH = (x) => ethers.parseEther(x);
const enUnaHora = async () => (await time.latest()) + 3600;

describe("Banco MITIGADO", function () {
  it("Keccak-256: guarda en la cadena solo el hash del comprobante y el id de la operación", async () => {
    const { banco, v1 } = await desplegar();
    const hashComprobante = ethers.keccak256(ethers.toUtf8Bytes("comprobante cifrado de prueba"));
    const total = await banco.totalOperaciones();
    const tx = await banco.connect(v1).depositar(hashComprobante, { value: ETH("1") });
    const id = ethers.keccak256(ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256", "bytes32", "uint256"], [v1.address, ETH("1"), hashComprobante, total]));
    await expect(tx).to.emit(banco, "Deposito").withArgs(id, v1.address, ETH("1"), hashComprobante);
    expect((await banco.operaciones(id)).hashComprobante).to.equal(hashComprobante);
  });

  it("Reentrancy: el ataque revierte y el banco conserva sus fondos", async () => {
    const { banco, atacanteEOA } = await desplegar();
    const atacante = await (await ethers.getContractFactory("Atacante")).connect(atacanteEOA).deploy(await banco.getAddress());
    await expect(atacante.connect(atacanteEOA).atacar({ value: ETH("1") })).to.be.revertedWith("Fallo el envio");
    expect(await banco.balanceContrato()).to.equal(ETH("10"));
  });

  it("Un retiro normal sigue funcionando", async () => {
    const { banco, v1 } = await desplegar();
    await expect(banco.connect(v1).retirar()).to.changeEtherBalance(v1, ETH("3"));
    expect(await banco.saldos(v1.address)).to.equal(0n);
  });

  it("Replay: la firma EIP-712 se cobra una sola vez (nonce)", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const deadline = await enUnaHora();
    const firma = await firmarEIP712(banco, v1, destinatario.address, ETH("1"), deadline);
    await banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, firma);
    expect(await banco.nonces(v1.address)).to.equal(1n);
    await expect(banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, firma))
      .to.be.revertedWith("Firma invalida");
    expect(await banco.saldos(v1.address)).to.equal(ETH("2"));
  });

  it("Replay entre contratos: la firma NO sirve en otro despliegue (dominio con verifyingContract)", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const otro = await (await ethers.getContractFactory("Banco")).deploy();
    await otro.connect(v1).depositar(ethers.ZeroHash, { value: ETH("2") });
    const deadline = await enUnaHora();
    const firma = await firmarEIP712(banco, v1, destinatario.address, ETH("1"), deadline);
    await expect(otro.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, firma))
      .to.be.revertedWith("Firma invalida");
  });

  it("Una firma EIP-191 sin dominio (la del banco vulnerable) no sirve", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const deadline = await enUnaHora();
    const firma = await firmarSimple(v1, destinatario.address, ETH("1"));
    await expect(banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, firma))
      .to.be.revertedWith("Firma invalida");
  });

  it("Firma expirada: revierte después del deadline", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const deadline = await enUnaHora();
    const firma = await firmarEIP712(banco, v1, destinatario.address, ETH("1"), deadline);
    await time.increaseTo(deadline + 1);
    await expect(banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, firma))
      .to.be.revertedWith("Firma expirada");
  });

  it("Maleabilidad ECDSA: rechaza la firma con s alto", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const deadline = await enUnaHora();
    const firma = await firmarEIP712(banco, v1, destinatario.address, ETH("1"), deadline);
    await expect(banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), deadline, malear(firma)))
      .to.be.revertedWithCustomError(banco, "ECDSAInvalidSignatureS");
  });
});
