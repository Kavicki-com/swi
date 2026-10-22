import { chipAnchors, chipEtaLabel, navArrow, navArrowAt, lineFeature, bearingDeg, routeNotice } from './routeFormat';
import type { RouteSnapshot } from './types';

// O traço (U+2014) é o que a função devolve quando não há tempo pra mostrar.
// Montado por código porque o caractere não entra no fonte (regra de escrita do
// projeto); a comparação é com ele de verdade.
const TRACO = String.fromCharCode(0x2014);

describe('routeFormat: chipEtaLabel', () => {
  it('deriva o tempo da duração REAL da rota, na fração onde a chip ancora', () => {
    // 30min de rota: a chip de 35% marca ~11min, a de 70% marca 21min.
    expect(chipEtaLabel(1800, 0.35)).toBe('11 minutos');
    expect(chipEtaLabel(1800, 0.7)).toBe('21 minutos');
  });

  it('concorda no singular', () => {
    expect(chipEtaLabel(120, 0.35)).toBe('1 minuto');
  });

  it('nunca mostra "0 minutos", trecho curto arredonda pra 1', () => {
    expect(chipEtaLabel(30, 0.35)).toBe('1 minuto');
  });

  it('sem rota carregada não inventa tempo', () => {
    expect(chipEtaLabel(null, 0.35)).toBe(TRACO);
    expect(chipEtaLabel(undefined, 0.35)).toBe(TRACO);
    expect(chipEtaLabel(0, 0.35)).toBe(TRACO);
  });
});

type Pt = [number, number];
const line: Pt[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];

describe('routeFormat: chipAnchors', () => {
  it('ancora em ~35% e ~70% do array', () => {
    expect(chipAnchors(line)).toEqual({ a: [1, 0], b: [3, 0] }); // floor(5*0.35)=1, floor(5*0.7)=3
  });
  it('null pra array vazio', () => {
    expect(chipAnchors([])).toBeNull();
  });
  it('clampa em 1 waypoint sem crashar', () => {
    expect(chipAnchors([[9, 9]])).toEqual({ a: [9, 9], b: [9, 9] });
  });
});

describe('routeFormat: navArrow', () => {
  it('posiciona a ~30% apontando pro próximo waypoint (leste = 90°)', () => {
    const arrow = navArrow(line); // floor(5*0.3)=1 → at=[1,0], next=[2,0]
    expect(arrow?.at).toEqual([1, 0]);
    expect(arrow?.rotation).toBeCloseTo(90);
  });
  it('null quando <2 waypoints', () => {
    expect(navArrow([[0, 0]])).toBeNull();
    expect(navArrow([])).toBeNull();
  });
});

describe('routeFormat: lineFeature', () => {
  it('embrulha os waypoints num Feature<LineString>', () => {
    expect(lineFeature(line)?.geometry).toEqual({ type: 'LineString', coordinates: line });
  });
  it('null pra array vazio', () => {
    expect(lineFeature([])).toBeNull();
  });
});

describe('routeFormat: bearingDeg', () => {
  it('norte/leste/sul/oeste', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0);    // norte
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90);   // leste
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180); // sul
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270); // oeste
  });
});

describe('routeFormat: navArrowAt', () => {
  // Rota em L: leste ate [2, 0], depois norte ate [2, 2].
  const L: [number, number][] = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2]];

  it('poe a seta onde a pessoa esta, nao num ponto da rota', () => {
    expect(navArrowAt([0.9, 0.1], L)?.at).toEqual([0.9, 0.1]);
  });

  it('aponta para o vertice seguinte ao mais proximo', () => {
    // Mais perto de [1, 0]: o proximo e [2, 0], a leste.
    expect(navArrowAt([1.1, 0], L)?.rotation).toBeCloseTo(90, 5);
    // Mais perto de [2, 1]: o proximo e [2, 2], ao norte.
    expect(navArrowAt([2, 1.1], L)?.rotation).toBeCloseTo(0, 5);
  });

  it('no ultimo vertice aponta para ele mesmo e cai no rumo do ultimo trecho', () => {
    expect(navArrowAt([2, 2], L)?.rotation).toBeCloseTo(0, 5);
  });

  it('rota com menos de dois pontos nao tem seta', () => {
    expect(navArrowAt([0, 0], [[0, 0]])).toBeNull();
  });
});

describe('routeFormat: routeNotice', () => {
  const rota = (approximate: boolean): RouteSnapshot => ({
    waypoints: [[0, 0], [1, 1]],
    durationSec: 60,
    distanceM: 100,
    fetchedAt: '2026-10-21T00:00:00.000Z',
    origin: [0, 0],
    destination: [1, 1],
    approximate,
  });

  it('rota normal nao tem aviso', () => {
    expect(routeNotice(rota(false), null)).toBeNull();
  });

  it('rota aproximada avisa para seguir o gestor', () => {
    expect(routeNotice(rota(true), null)).toEqual({
      variant: 'warning',
      text: 'Rota aproximada: siga as orientações do gestor.',
    });
  });

  it.each([
    ['no-evacuation', 'Nenhuma evacuação em andamento com ponto de encontro.'],
    ['no-position', 'Ative a localização para traçar a rota.'],
    ['failed', 'Não foi possível traçar a rota. Siga as orientações do gestor.'],
  ] as const)('erro %s tem frase propria', (kind, text) => {
    expect(routeNotice(null, kind)).toEqual({ variant: 'error', text });
  });

  it('carregando (sem rota e sem erro) nao tem aviso', () => {
    expect(routeNotice(null, null)).toBeNull();
  });
});
