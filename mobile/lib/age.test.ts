import { ageFrom } from './age';

describe('ageFrom', () => {
  // Meio-dia LOCAL: com meia-noite UTC o teste passaria a depender do fuso da
  // máquina (em UTC-3 o "hoje" local viraria o dia anterior).
  const REF = new Date(2026, 6, 26, 12, 0, 0);

  beforeAll(() => {
    jest.useFakeTimers().setSystemTime(REF);
  });
  afterAll(() => {
    jest.useRealTimers();
  });

  it('conta anos completos', () => {
    expect(ageFrom('1990-12-25T00:00:00.000Z')).toBe(35);
  });

  it('desconta o ano quando o aniversário ainda não chegou', () => {
    // 26/07 é hoje → já fez; 27/07 é amanhã → ainda não fez.
    expect(ageFrom('2000-07-26T00:00:00.000Z')).toBe(26);
    expect(ageFrom('2000-07-27T00:00:00.000Z')).toBe(25);
  });

  it('devolve null sem data ou com data inválida (a tela mostra "Não informado")', () => {
    expect(ageFrom(null)).toBeNull();
    expect(ageFrom(undefined)).toBeNull();
    expect(ageFrom('')).toBeNull();
    expect(ageFrom('não é data')).toBeNull();
  });

  it('rejeita datas absurdas em vez de exibir idade impossível', () => {
    expect(ageFrom('1700-01-01T00:00:00.000Z')).toBeNull();
    expect(ageFrom('2030-01-01T00:00:00.000Z')).toBeNull();
  });
});
