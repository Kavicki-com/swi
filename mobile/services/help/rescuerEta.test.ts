import { etaLabel, rescuerEtaMinutes } from './rescuerEta';
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

describe('rescuerEtaMinutes', () => {
  it('socorrista despachado a ~1,1 km leva 13 minutos a pé', () => {
    expect(rescuerEtaMinutes(pedido(), AQUI)).toBe(13);
  });

  it('a posição do funcionário vem em [lng, lat]', () => {
    // Socorrista 0,01 grau a leste: mesma distância do norte no Equador.
    const leste = pedido({
      rescue: { ...pedido().rescue!, rescuerPosition: { lat: 0, lng: 0.01, recordedAt: 'x' } },
    });
    expect(rescuerEtaMinutes(leste, AQUI)).toBe(13);
    expect(rescuerEtaMinutes(leste, [0.01, 0])).toBe(1);
  });

  it('colado no funcionário ainda é 1 minuto, nunca 0', () => {
    const colado = pedido({
      rescue: { ...pedido().rescue!, rescuerPosition: { lat: 0, lng: 0, recordedAt: 'x' } },
    });
    expect(rescuerEtaMinutes(colado, AQUI)).toBe(1);
  });

  it.each([
    ['sem pedido', null],
    ['pedido sem resgate', pedido({ status: 'OPEN', attendedAt: null, rescue: null })],
    ['pedido encerrado', pedido({ status: 'CLOSED', closedAt: '2026-10-22T13:00:00.000Z' })],
    ['socorrista já chegou', pedido({ rescue: { ...pedido().rescue!, status: 'arrived' } })],
    ['resgate encerrado', pedido({ rescue: { ...pedido().rescue!, status: 'ended' } })],
    ['socorrista sem posição', pedido({ rescue: { ...pedido().rescue!, rescuerPosition: null } })],
  ])('%s: sem tempo', (_caso, help) => {
    expect(rescuerEtaMinutes(help, AQUI)).toBeNull();
  });

  it('sem a posição do funcionário: sem tempo', () => {
    expect(rescuerEtaMinutes(pedido(), null)).toBeNull();
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
