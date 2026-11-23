# Proyecto Criptografía — Reentrancy en smart contracts

Dos stacks idénticos levantados con Docker Compose:

| Stack | Frontend + API | Nodo Hardhat (RPC) | Contrato |
|---|---|---|---|
| Vulnerable | http://localhost:3001 | localhost:8545 | `Banco.sol` envía ETH antes de poner el saldo en 0 |
| Mitigada | http://localhost:3002 | localhost:8546 | Checks-Effects-Interactions + `ReentrancyGuard` (OpenZeppelin) |

Al arrancar, cada nodo despliega su `Banco` y 3 víctimas depositan 10 ETH en total.
El botón **Lanzar ataque** despliega `Atacante.sol` y ejecuta la reentrancy.

## Estructura

```
proyecto-cripto/
├── docker-compose.yml
├── docker/            chain.Dockerfile + start-chain.sh (nodo + deploy)
├── vulnerable/contracts/   Hardhat: Banco.sol vulnerable + scripts/deploy.js
├── mitigada/contracts/     Hardhat: Banco.sol mitigado + scripts/deploy.js
├── ataques/contracts/      Atacante.sol (se compila dentro de cada nodo)
└── app/               backend Express + ethers y frontend (public/)
```

## Uso

```bash
docker compose up --build -d     # levantar (la primera vez tarda unos minutos)
docker compose logs -f           # ver logs
docker compose down -v           # apagar y borrar estado (reinicio limpio)
```

## API (sirve para probar desde la terminal)

```bash
curl localhost:3001/estado
curl -X POST localhost:3001/atacar
curl -X POST -H 'Content-Type: application/json' -d '{"cuenta":"victima1","monto":"2"}' localhost:3001/depositar
curl -X POST -H 'Content-Type: application/json' -d '{"cuenta":"victima1"}' localhost:3001/retirar
```

Cuentas: `victima1`, `victima2`, `victima3` (cuentas 1–3 de Hardhat) y `atacante` (cuenta 9).
