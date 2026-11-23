#!/bin/sh
# Arranca el nodo, despliega el Banco y deja el nodo corriendo
rm -f /shared/deployed.json
npx hardhat node --hostname 0.0.0.0 &
NODO=$!
npx hardhat run scripts/deploy.js --network localhost
wait $NODO
