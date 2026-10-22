import { decodeBase64, parseHeartRateMeasurement } from './heartRateMeasurement';

// Casos escritos da especificação do 0x2A37 (Heart Rate Measurement, perfil
// padrão de batimento), não do código: byte 0 são as flags, depois o batimento
// em 8 ou 16 bits, a energia gasta e os intervalos RR, nessa ordem.
const bytes = (...values: number[]) => Uint8Array.from(values);

const FORMAT_16 = 0b0000_0001;
const CONTACT_DETECTED = 0b0000_0010;
const CONTACT_SUPPORTED = 0b0000_0100;
const ENERGY = 0b0000_1000;
const RR = 0b0001_0000;

describe('parseHeartRateMeasurement', () => {
  it('lê o batimento em 8 bits sem suporte a contato', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 72))).toEqual({ bpm: 72, contact: 'unsupported' });
  });

  it('lê o batimento em 16 bits, byte menos significativo primeiro', () => {
    // 0x012C = 300
    expect(parseHeartRateMeasurement(bytes(FORMAT_16, 0x2c, 0x01))).toEqual({
      bpm: 300,
      contact: 'unsupported',
    });
  });

  it('lê 8 bits acima de 127 sem sinal', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 0xb4))?.bpm).toBe(180);
  });

  it('contato suportado e detectado', () => {
    expect(parseHeartRateMeasurement(bytes(CONTACT_SUPPORTED | CONTACT_DETECTED, 80))).toEqual({
      bpm: 80,
      contact: 'detected',
    });
  });

  it('contato suportado e não detectado', () => {
    expect(parseHeartRateMeasurement(bytes(CONTACT_SUPPORTED, 80))).toEqual({
      bpm: 80,
      contact: 'notDetected',
    });
  });

  it('sem o bit de suporte, o bit de contato não diz nada', () => {
    expect(parseHeartRateMeasurement(bytes(CONTACT_DETECTED, 80))?.contact).toBe('unsupported');
  });

  it('pula a energia gasta', () => {
    expect(parseHeartRateMeasurement(bytes(ENERGY, 95, 0x10, 0x27))).toEqual({
      bpm: 95,
      contact: 'unsupported',
    });
  });

  it('ignora os intervalos RR', () => {
    expect(parseHeartRateMeasurement(bytes(RR, 64, 0x00, 0x04, 0x10, 0x04))?.bpm).toBe(64);
  });

  it('energia e RR juntos, com 16 bits e contato', () => {
    const flags = FORMAT_16 | CONTACT_SUPPORTED | CONTACT_DETECTED | ENERGY | RR;
    expect(parseHeartRateMeasurement(bytes(flags, 0x8c, 0x00, 0x01, 0x00, 0x00, 0x04))).toEqual({
      bpm: 140,
      contact: 'detected',
    });
  });

  it('devolve bpm 0 como veio (o descarte é de quem drena)', () => {
    expect(parseHeartRateMeasurement(bytes(0x00, 0))).toEqual({ bpm: 0, contact: 'unsupported' });
  });

  it('pacote vazio é descartado', () => {
    expect(parseHeartRateMeasurement(bytes())).toBeNull();
  });

  it('só as flags, sem batimento, é descartado', () => {
    expect(parseHeartRateMeasurement(bytes(0x00))).toBeNull();
  });

  it('16 bits declarados com um byte só é descartado', () => {
    expect(parseHeartRateMeasurement(bytes(FORMAT_16, 0x50))).toBeNull();
  });

  it('energia declarada sem os dois bytes é descartado', () => {
    expect(parseHeartRateMeasurement(bytes(ENERGY, 90, 0x10))).toBeNull();
  });

  it('RR declarado sem nenhum intervalo é descartado', () => {
    expect(parseHeartRateMeasurement(bytes(RR, 90))).toBeNull();
    expect(parseHeartRateMeasurement(bytes(RR, 90, 0x01))).toBeNull();
  });
});

describe('decodeBase64', () => {
  it('decodifica com e sem preenchimento', () => {
    expect(Array.from(decodeBase64('AEg=') ?? [])).toEqual([0x00, 0x48]);
    expect(Array.from(decodeBase64('FowAAQAABA==') ?? [])).toEqual([
      0x16, 0x8c, 0x00, 0x01, 0x00, 0x00, 0x04,
    ]);
    expect(Array.from(decodeBase64('AQIDBA') ?? [])).toEqual([1, 2, 3, 4]);
  });

  it('cobre o alfabeto inteiro igual ao Buffer do Node', () => {
    const all = Uint8Array.from({ length: 256 }, (_, i) => i);
    const text = Buffer.from(all).toString('base64');
    expect(Array.from(decodeBase64(text) ?? [])).toEqual(Array.from(all));
  });

  it('texto vazio dá bytes vazios', () => {
    expect(decodeBase64('')?.length).toBe(0);
  });

  it('recusa caractere fora do alfabeto, comprimento impossível e preenchimento no meio', () => {
    expect(decodeBase64('AE*=')).toBeNull();
    expect(decodeBase64('A')).toBeNull();
    expect(decodeBase64('AE=A')).toBeNull();
    expect(decodeBase64('AEg==')).toBeNull();
  });
});
