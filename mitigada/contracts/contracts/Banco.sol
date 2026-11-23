// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/// @title Banco — VERSIÓN MITIGADA
/// @notice Reentrancy: patrón Checks-Effects-Interactions + ReentrancyGuard de OpenZeppelin.
/// @notice Replay: firmas EIP-712 con dominio (nombre, versión, chainId, dirección del contrato),
///         nonce por titular y fecha de expiración. ECDSA.recover rechaza firmas maleables.
contract Banco is ReentrancyGuard, EIP712 {
    struct Operacion {
        address cuenta;
        uint256 monto;
        bytes32 hashComprobante; // Keccak-256 del comprobante cifrado con AES-256-GCM (fuera de la cadena)
        uint256 fecha;
    }

    bytes32 public constant PAGO_TYPEHASH =
        keccak256("Pago(address titular,address destinatario,uint256 monto,uint256 nonce,uint256 deadline)");

    mapping(address => uint256) public saldos;
    mapping(address => uint256) public nonces;
    mapping(bytes32 => Operacion) public operaciones;
    uint256 public totalOperaciones;

    event Deposito(bytes32 indexed idOperacion, address indexed cuenta, uint256 monto, bytes32 hashComprobante);
    event Retiro(address indexed cuenta, uint256 monto);
    event PagoFirmado(address indexed titular, address indexed destinatario, uint256 monto, uint256 nonce);

    constructor() EIP712("BancoCripto", "1") {}

    /// @param hashComprobante Keccak-256 del comprobante cifrado; en la cadena solo queda el hash
    function depositar(bytes32 hashComprobante) external payable {
        require(msg.value > 0, "Monto invalido");
        saldos[msg.sender] += msg.value;

        bytes32 id = keccak256(abi.encode(msg.sender, msg.value, hashComprobante, totalOperaciones));
        operaciones[id] = Operacion(msg.sender, msg.value, hashComprobante, block.timestamp);
        totalOperaciones++;

        emit Deposito(id, msg.sender, msg.value, hashComprobante);
    }

    /// MITIGADO: Checks -> Effects -> Interactions, y además nonReentrant
    function retirar() external nonReentrant {
        uint256 monto = saldos[msg.sender];          // Checks
        require(monto > 0, "Sin saldo");

        saldos[msg.sender] = 0;                      // Effects

        (bool ok, ) = msg.sender.call{value: monto}(""); // Interactions
        require(ok, "Fallo el envio");
        emit Retiro(msg.sender, monto);
    }

    /// MITIGADO: firma EIP-712 ligada a este contrato y esta red, con nonce de un solo uso
    function pagarConFirma(
        address titular,
        address destinatario,
        uint256 monto,
        uint256 deadline,
        bytes calldata firma
    ) external nonReentrant {
        require(block.timestamp <= deadline, "Firma expirada");

        uint256 nonce = nonces[titular];
        bytes32 structHash = keccak256(abi.encode(PAGO_TYPEHASH, titular, destinatario, monto, nonce, deadline));
        bytes32 digest = _hashTypedDataV4(structHash);

        // ECDSA.recover revierte con firmas maleables (s alto) o inválidas (address(0))
        require(ECDSA.recover(digest, firma) == titular, "Firma invalida");
        require(saldos[titular] >= monto, "Saldo insuficiente");

        nonces[titular] = nonce + 1;                 // la firma queda "gastada"
        saldos[titular] -= monto;

        (bool ok, ) = destinatario.call{value: monto}("");
        require(ok, "Fallo el envio");

        emit PagoFirmado(titular, destinatario, monto, nonce);
    }

    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    function balanceContrato() external view returns (uint256) {
        return address(this).balance;
    }
}
