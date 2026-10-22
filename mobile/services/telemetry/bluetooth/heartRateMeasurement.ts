// Interpretação de uma notificação do 0x2A37 (Heart Rate Measurement), o
// formato do perfil padrão de batimento que pulseiras, cintas e relógios em
// modo transmissão usam. O Kotlin guarda os bytes crus; quem entende o
// formato é este arquivo, para a regra ficar testável no CI.
//
// Byte 0 são as flags:
// - bit 0: batimento em 8 bits (0) ou 16 bits, menos significativo primeiro (1);
// - bit 1: contato com a pele detectado;
// - bit 2: o sensor sabe dizer se há contato (sem ele, o bit 1 não vale);
// - bit 3: energia gasta presente (2 bytes, pulados);
// - bit 4: intervalos RR presentes (2 bytes cada até o fim, ignorados).
// Pacote mais curto do que as flags declaram é descartado inteiro.

export type HeartRateContact = 'detected' | 'notDetected' | 'unsupported';

export interface HeartRateMeasurement {
  bpm: number;
  contact: HeartRateContact;
}

const FORMAT_16 = 0b0000_0001;
const CONTACT_DETECTED = 0b0000_0010;
const CONTACT_SUPPORTED = 0b0000_0100;
const ENERGY_PRESENT = 0b0000_1000;
const RR_PRESENT = 0b0001_0000;

export function parseHeartRateMeasurement(bytes: Uint8Array): HeartRateMeasurement | null {
  if (bytes.length < 2) return null;
  const flags = bytes[0];
  const wide = (flags & FORMAT_16) !== 0;
  const bpmEnd = wide ? 3 : 2;
  // Energia e RR não entram no batimento, mas o tamanho que elas declaram
  // conta: um pacote truncado pode ter perdido justamente o fim do valor.
  let required = bpmEnd;
  if (flags & ENERGY_PRESENT) required += 2;
  if (flags & RR_PRESENT) required += 2;
  if (bytes.length < required) return null;

  const bpm = wide ? bytes[1] | (bytes[2] << 8) : bytes[1];
  let contact: HeartRateContact = 'unsupported';
  if (flags & CONTACT_SUPPORTED) {
    contact = flags & CONTACT_DETECTED ? 'detected' : 'notDetected';
  }
  return { bpm, contact };
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const DECODE: Record<string, number> = Object.fromEntries(
  Array.from(ALPHABET, (char, index) => [char, index]),
);

/**
 * Base64 padrão (com ou sem `=` no fim) para bytes, ou null se o texto não for
 * base64. Própria porque o React Native não tem `Buffer`, e o `atob` do Hermes
 * devolve texto, não bytes.
 */
export function decodeBase64(text: string): Uint8Array | null {
  const body = text.replace(/={1,2}$/, '');
  if (body.length % 4 === 1) return null;
  if (text.length !== body.length && text.length % 4 !== 0) return null;

  const out = new Uint8Array(Math.floor((body.length * 3) / 4));
  let buffer = 0;
  let bits = 0;
  let index = 0;
  for (const char of body) {
    const value = DECODE[char];
    if (value === undefined) return null;
    buffer = (buffer << 6) | value;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[index] = (buffer >> bits) & 0xff;
      index += 1;
    }
  }
  return out;
}
