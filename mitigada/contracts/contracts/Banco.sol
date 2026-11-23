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
