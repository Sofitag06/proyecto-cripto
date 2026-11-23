// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title Banco — VERSIÓN VULNERABLE (solo para la demostración, no usar en producción)
/// @notice Vulnerabilidad 1: reentrancy en retirar() — envía el ETH antes de actualizar el saldo.
/// @notice Vulnerabilidad 2: replay de firmas en pagarConFirma() — el mensaje firmado no lleva
///         nonce, chainId ni la dirección del contrato, así que la misma firma sirve infinitas veces.
contract Banco {
    struct Operacion {
        address cuenta;
        uint256 monto;
        bytes32 hashComprobante; // Keccak-256 del comprobante cifrado con AES-256-GCM (fuera de la cadena)
        uint256 fecha;
    }

    mapping(address => uint256) public saldos;
    mapping(bytes32 => Operacion) public operaciones;
    uint256 public totalOperaciones;

    event Deposito(bytes32 indexed idOperacion, address indexed cuenta, uint256 monto, bytes32 hashComprobante);
    event Retiro(address indexed cuenta, uint256 monto);
    event PagoFirmado(address indexed titular, address indexed destinatario, uint256 monto);

    /// @param hashComprobante Keccak-256 del comprobante cifrado; en la cadena solo queda el hash
    function depositar(bytes32 hashComprobante) external payable {
        require(msg.value > 0, "Monto invalido");
        saldos[msg.sender] += msg.value;

        // Identificador de la operación = Keccak-256 de sus datos (prueba de integridad)
        bytes32 id = keccak256(abi.encode(msg.sender, msg.value, hashComprobante, totalOperaciones));
        operaciones[id] = Operacion(msg.sender, msg.value, hashComprobante, block.timestamp);
        totalOperaciones++;

        emit Deposito(id, msg.sender, msg.value, hashComprobante);
    }

    /// VULNERABLE (reentrancy): interacción externa ANTES de actualizar el estado
    function retirar() external {
        uint256 monto = saldos[msg.sender];
        require(monto > 0, "Sin saldo");

        (bool ok, ) = msg.sender.call{value: monto}("");
        require(ok, "Fallo el envio");

        saldos[msg.sender] = 0;
        emit Retiro(msg.sender, monto);
    }

    /// VULNERABLE (replay): el titular firma (titular, destinatario, monto) con EIP-191 (personal_sign).
    /// Sin nonce, sin chainId y sin dirección del contrato: cualquiera que vea la firma
    /// (por ejemplo, en los datos de la transacción, que son públicos) puede reenviarla.
    function pagarConFirma(address titular, address destinatario, uint256 monto, bytes calldata firma) external {
        bytes32 hashMensaje = keccak256(abi.encodePacked(titular, destinatario, monto));
        bytes32 digest = keccak256(abi.encodePacked("\x19Ethereum Signed Message:\n32", hashMensaje));

        require(_recuperar(digest, firma) == titular, "Firma invalida");
        require(saldos[titular] >= monto, "Saldo insuficiente");

        saldos[titular] -= monto;
        (bool ok, ) = destinatario.call{value: monto}("");
        require(ok, "Fallo el envio");

        emit PagoFirmado(titular, destinatario, monto);
    }

    /// ecrecover "a mano": no valida que s esté en la mitad baja de la curva (firmas maleables)
    function _recuperar(bytes32 digest, bytes calldata firma) internal pure returns (address) {
        require(firma.length == 65, "Largo de firma invalido");
        bytes32 r;
        bytes32 s;
        uint8 v;
        assembly {
            r := calldataload(firma.offset)
            s := calldataload(add(firma.offset, 32))
            v := byte(0, calldataload(add(firma.offset, 64)))
        }
        return ecrecover(digest, v, r, s);
    }

    function balanceContrato() external view returns (uint256) {
        return address(this).balance;
    }
}
