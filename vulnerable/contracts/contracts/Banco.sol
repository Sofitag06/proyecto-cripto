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
