const { expect } = require("chai");
const { ethers } = require("hardhat");
const { desplegar, firmarSimple, malear } = require("./helpers");

const ETH = (x) => ethers.parseEther(x);

describe("Banco VULNERABLE", function () {
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

  it("Reentrancy: el atacante vacía el banco con 1 ETH", async () => {
    const { banco, atacanteEOA } = await desplegar();
    const atacante = await (await ethers.getContractFactory("Atacante")).connect(atacanteEOA).deploy(await banco.getAddress());
    await atacante.connect(atacanteEOA).atacar({ value: ETH("1") });
    expect(await banco.balanceContrato()).to.equal(0n);
    expect(await ethers.provider.getBalance(await atacante.getAddress())).to.equal(ETH("11"));
    expect(await atacante.reentradas()).to.equal(10n);
  });

  it("Replay: la misma firma de 1 ETH se cobra 3 veces", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const firma = await firmarSimple(v1, destinatario.address, ETH("1"));
    for (let i = 0; i < 3; i++) {
      await banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), firma);
    }
    expect(await banco.saldos(v1.address)).to.equal(0n);
  });

  it("Replay entre contratos: la firma sirve en OTRO despliegue del banco (sin dominio)", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const otro = await (await ethers.getContractFactory("Banco")).deploy();
    await otro.connect(v1).depositar(ethers.ZeroHash, { value: ETH("2") });
    const firma = await firmarSimple(v1, destinatario.address, ETH("1"));
    await banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), firma);
    await otro.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), firma);
    expect(await otro.saldos(v1.address)).to.equal(ETH("1"));
  });

  it("Maleabilidad ECDSA: acepta una segunda firma válida (s' = n - s) del mismo mensaje", async () => {
    const { banco, v1, destinatario } = await desplegar();
    const firma = await firmarSimple(v1, destinatario.address, ETH("1"));
    await banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), malear(firma));
    expect(await banco.saldos(v1.address)).to.equal(ETH("2"));
  });

  it("Rechaza firmas de otra persona", async () => {
    const { banco, v1, v2, destinatario } = await desplegar();
    const firma = await firmarSimple(v2, destinatario.address, ETH("1"));
    await expect(banco.connect(destinatario).pagarConFirma(v1.address, destinatario.address, ETH("1"), firma))
      .to.be.revertedWith("Firma invalida");
  });
});
