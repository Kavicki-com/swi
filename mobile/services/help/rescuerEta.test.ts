import { etaLabel, RESCUER_POSITION_MAX_AGE_MS, rescuerEtaMinutes } from './rescuerEta';
import type { HelpRequestView } from './types';

// Tempo do socorrista despachado até o funcionário, na régua do painel: a
// mesma distância e a mesma velocidade a pé da lista de socorristas, para o
// número que a pessoa vê bater com o que a central viu ao despachar.

const pedido = (over: Partial<HelpRequestView> = {}): HelpRequestView => ({
  id: 'h1',
  status: 'ATTENDED',
  createdAt: '2026-10-22T12:00:00.000Z',
  attendedAt: '2026-10-22T12:01:00.000Z',
  closedAt: null,
  rescue: {
    id: 'r1',
    status: 'dispatched',
    dispatchedAt: '2026-10-22T12:01:00.000Z',
    arrivedAt: null,
    rescuerPosition: { lat: 0.01, lng: 0, recordedAt: '2026-10-22T12:01:00.000Z' },
  },
  ...over,
});

// [lng, lat], a convenção do LocationProvider.
const AQUI: [number, number] = [0, 0];
// Um minuto depois da posição do socorrista: leitura recente.
const AGORA = Date.parse('2026-10-22T12:02:00.000Z');
const RECENTE = '2026-10-22T12:01:00.000Z';

describe('rescuerEtaMinutes', () => {
  it('socorrista despachado a ~1,1 km leva 13 minutos a pé', () => {
    expect(rescuerEtaMinutes(pedido(), AQUI, AGORA)).toBe(13);
  });

  it('a posição do funcionário vem em [lng, lat]', () => {
    // Socorrista 0,01 grau a leste: mesma distância do norte no Equador.
    const leste = pedido({
      rescue: { ...pedido().rescue!, rescuerPosition: { lat: 0, lng: 0.01, recordedAt: RECENTE } },
    });
    expect(rescuerEtaMinutes(leste, AQUI, AGORA)).toBe(13);
    expect(rescuerEtaMinutes(leste, [0.01, 0], AGORA)).toBe(1);
  });

  it('colado no funcionário ainda é 1 minuto, nunca 0', () => {
    const colado = pedido({
      rescue: { ...pedido().rescue!, rescuerPosition: { lat: 0, lng: 0, recordedAt: RECENTE } },
    });
    expect(rescuerEtaMinutes(colado, AQUI, AGORA)).toBe(1);
  });

  it.each([
    ['sem pedido', null],
    ['pedido sem resgate', pedido({ status: 'OPEN', attendedAt: null, rescue: null })],
    ['pedido encerrado', pedido({ status: 'CLOSED', closedAt: '2026-10-22T13:00:00.000Z' })],
    ['socorrista já chegou', pedido({ rescue: { ...pedido().rescue!, status: 'arrived' } })],
    ['resgate encerrado', pedido({ rescue: { ...pedido().rescue!, status: 'ended' } })],
    ['socorrista sem posição', pedido({ rescue: { ...pedido().rescue!, rescuerPosition: null } })],
  ])('%s: sem tempo', (_caso, help) => {
    expect(rescuerEtaMinutes(help, AQUI, AGORA)).toBeNull();
  });

  it('sem a posição do funcionário: sem tempo', () => {
    expect(rescuerEtaMinutes(pedido(), null, AGORA)).toBeNull();
  });

  // Posição velha é de um socorrista que pode estar em qualquer lugar (celular
  // sem sinal): estimar dela seria afirmar um tempo que ninguém mediu.
  describe('idade da posição do socorrista', () => {
    const lida = Date.parse(RECENTE);

    it('o limite é de 5 minutos', () => {
      expect(RESCUER_POSITION_MAX_AGE_MS).toBe(5 * 60_000);
    });

    it('com exatamente 5 minutos ainda vale', () => {
      expect(rescuerEtaMinutes(pedido(), AQUI, lida + RESCUER_POSITION_MAX_AGE_MS)).toBe(13);
    });

    it('mais velha que 5 minutos: sem tempo', () => {
      expect(rescuerEtaMinutes(pedido(), AQUI, lida + RESCUER_POSITION_MAX_AGE_MS + 1)).toBeNull();
    });

    it('hora da posição ilegível: sem tempo', () => {
      const ilegivel = pedido({
        rescue: { ...pedido().rescue!, rescuerPosition: { lat: 0.01, lng: 0, recordedAt: 'x' } },
      });
      expect(rescuerEtaMinutes(ilegivel, AQUI, AGORA)).toBeNull();
    });

    it('sem o relógio informado, usa a hora atual', () => {
      jest.useFakeTimers().setSystemTime(lida + 6 * 60_000);
      try {
        expect(rescuerEtaMinutes(pedido(), AQUI)).toBeNull();
      } finally {
        jest.useRealTimers();
      }
    });
  });
});

describe('etaLabel', () => {
  it('plural', () => {
    expect(etaLabel(7)).toBe('Aprox. 7 minutos');
  });

  it('singular', () => {
    expect(etaLabel(1)).toBe('Aprox. 1 minuto');
  });
});
