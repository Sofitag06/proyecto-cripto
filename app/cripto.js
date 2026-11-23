// Criptografía fuera de la cadena: AES-256-GCM para los comprobantes + Keccak-256 para la integridad.
const crypto = require("crypto");
const { ethers } = require("ethers");

// Clave maestra de 256 bits (en producción vendría de un KMS / gestor de secretos, nunca del código)
let CLAVE_MAESTRA;
if (process.env.CLAVE_MAESTRA && /^[0-9a-fA-F]{64}$/.test(process.env.CLAVE_MAESTRA)) {
  CLAVE_MAESTRA = Buffer.from(process.env.CLAVE_MAESTRA, "hex");
} else {
  CLAVE_MAESTRA = crypto.randomBytes(32);
  console.warn("CLAVE_MAESTRA no definida: se generó una aleatoria (los comprobantes no sobreviven un reinicio)");
}

// HKDF-SHA256: deriva una clave AES distinta para cada cuenta a partir de la clave maestra
function claveDeCuenta(direccion) {
  return Buffer.from(crypto.hkdfSync("sha256", CLAVE_MAESTRA, Buffer.from(direccion.toLowerCase()), "banco-comprobantes-v1", 32));
}

/**
 * Cifra el comprobante con AES-256-GCM.
 * - IV (vector de inicialización) de 96 bits aleatorio y único por mensaje
 * - AAD (datos adicionales autenticados) = dirección del titular: el cifrado queda ligado a su dueño
 * - Tag de autenticación de 128 bits: detecta cualquier modificación
 */
function cifrar(texto, direccion) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", claveDeCuenta(direccion), iv);
  cipher.setAAD(Buffer.from(direccion.toLowerCase()));
  const cifrado = Buffer.concat([cipher.update(texto, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString("hex"), cifrado: cifrado.toString("hex"), tag: tag.toString("hex") };
}

function descifrar({ iv, cifrado, tag }, direccion) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", claveDeCuenta(direccion), Buffer.from(iv, "hex"));
  decipher.setAAD(Buffer.from(direccion.toLowerCase()));
  decipher.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(cifrado, "hex")), decipher.final()]).toString("utf8");
}

// Keccak-256 de (IV || texto cifrado || tag): es lo único que se guarda en la blockchain
function hashComprobante({ iv, cifrado, tag }) {
  return ethers.keccak256(ethers.concat(["0x" + iv, "0x" + cifrado, "0x" + tag]));
}

module.exports = { cifrar, descifrar, hashComprobante };
