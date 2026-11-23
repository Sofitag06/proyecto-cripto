# BancoCripto — Ataques a smart contracts y su mitigación

Proyecto final de Criptografía. Un banco descentralizado en Solidity, desplegado en **dos versiones idénticas y aisladas**
(vulnerable y mitigada), contra las que se ejecutan **dos ataques**:

| # | Ataque | Tipo | Vulnerable | Mitigada |
|---|---|---|---|---|
| 1 | **Reentrancy** | Lógica del contrato | `retirar()` envía ETH antes de poner el saldo en 0 | Checks-Effects-Interactions + `ReentrancyGuard` |
| 2 | **Replay de firmas** | Criptográfico | Firma EIP-191 de `(titular, destinatario, monto)`: sin nonce, sin `chainId`, sin contrato, `ecrecover` maleable | Firma **EIP-712** con dominio (`name`, `version`, `chainId`, `verifyingContract`), **nonce**, **deadline** y `ECDSA.recover` (rechaza `s` alto) |

## Criptografía aplicada

| Algoritmo | Dónde | Para qué |
|---|---|---|
| **ECDSA sobre secp256k1** | Backend (firma) y contrato (`ecrecover` / `ECDSA.recover`) | Firmar transacciones y autorizar pagos fuera de la cadena |
| **EIP-191 / EIP-712** | Firma de pagos | Esquema vulnerable vs. datos tipados con separador de dominio |
| **Keccak-256** | Contrato | Id de cada operación y hash del comprobante como prueba de integridad |
| **AES-256-GCM** | Backend (fuera de la cadena) | Cifrado autenticado del comprobante; IV de 96 bits aleatorio; AAD = dirección del titular |
| **HKDF-SHA256** | Backend | Deriva una clave AES distinta por cuenta a partir de la clave maestra |
| **BIP-39 / BIP-32** | Backend y scripts | Derivación de las llaves privadas de las cuentas de prueba |

Flujo del comprobante:

```
nota ──AES-256-GCM──► {IV, cifrado, tag} ──► base de datos (fuera de la cadena)
                              │
                          Keccak-256
                              ▼
                 depositar(hashComprobante) ──► blockchain
Verificación: Keccak(cifrado guardado) == hash en cadena  y  tag GCM válido
```

## Arquitectura

```
                 red-vulnerable                          red-mitigada
┌──────────────────────────────────────┐ ┌──────────────────────────────────────┐
│ chain-vulnerable  :8545              │ │ chain-mitigada    :8546              │
│  Hardhat node + Banco vulnerable     │ │  Hardhat node + Banco mitigado       │
│        │ /shared/deployed.json       │ │        │ /shared/deployed.json       │
│ app-vulnerable    :3001              │ │ app-mitigada      :3002              │
│  Express + ethers + AES-GCM + web    │ │  Express + ethers + AES-GCM + web    │
└──────────────────────────────────────┘ └──────────────────────────────────────┘
```

```
proyecto-cripto/
├── docker-compose.yml
├── docker/                 chain.Dockerfile + start-chain.sh (nodo + despliegue)
├── vulnerable/contracts/   Hardhat: Banco.sol vulnerable, deploy.js, tests
├── mitigada/contracts/     Hardhat: Banco.sol mitigado, deploy.js, tests
├── ataques/                Atacante.sol + scripts de ataque del atacante (reentrancy.js, replay.js)
└── app/                    backend (server.js, cripto.js) + frontend (public/index.html)
```

## Levantar

```bash
sudo docker compose up --build -d     # la primera vez tarda unos minutos
sudo docker compose ps                # deben estar los 4 contenedores "Up"
sudo docker compose down -v           # apagar y borrar todo (reinicio limpio)
```

- Versión vulnerable: http://localhost:3001
- Versión mitigada: http://localhost:3002

## Tests (evidencia formal)

```bash
sudo docker compose exec chain-vulnerable npx hardhat test   # 6 tests: los ataques funcionan
sudo docker compose exec chain-mitigada  npx hardhat test    # 8 tests: los ataques fallan
```

## Ataques desde la terminal (atacante)

```bash
cd ataques && npm install
node reentrancy.js vulnerable    # roba los fondos del banco
node reentrancy.js mitigada      # revierte: "Fallo el envio"

# replay: antes hacer un "Pago firmado legítimo" en el frontend
node replay.js vulnerable 3      # la misma firma se cobra varias veces
node replay.js mitigada 3        # revierte: "Firma invalida" (nonce gastado)
```

Desde otra máquina: `HOST=<ip-de-la-vm> node reentrancy.js vulnerable`.

## API

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/estado` | Balances, saldos, nonces y esquema de firma |
| GET | `/contrato` | Dirección y ABI (lo usa el atacante) |
| POST | `/depositar` | `{cuenta, monto, nota}` — cifra la nota y registra su hash |
| POST | `/retirar` | `{cuenta}` |
| GET | `/operaciones` | Comprobantes con verificación Keccak + GCM |
| POST | `/comprobante/:id/alterar` | Cambia 1 bit del cifrado (demo de integridad) |
| POST | `/pago-firmado` | `{cuenta, destinatario, monto}` — pago legítimo firmado |
| POST | `/atacar` | Ataque 1: reentrancy |
| POST | `/ataque-replay` | `{veces}` — Ataque 2: replay de la última firma en la cadena |

Cuentas de prueba (Hardhat): `victima1..3` = cuentas 1–3, `atacante` = cuenta 9.

> La clave maestra AES del `docker-compose.yml` y el mnemónico de Hardhat son públicos y **solo para la demo**.
