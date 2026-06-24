import { chipAnchors, navArrow, lineFeature, bearingDeg, straightLine } from './routeFormat';

type Pt = [number, number];
const line: Pt[] = [[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]];

describe('routeFormat — chipAnchors', () => {
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

describe('routeFormat — navArrow', () => {
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

describe('routeFormat — lineFeature', () => {
  it('embrulha os waypoints num Feature<LineString>', () => {
    expect(lineFeature(line)?.geometry).toEqual({ type: 'LineString', coordinates: line });
  });
  it('null pra array vazio', () => {
    expect(lineFeature([])).toBeNull();
  });
});

describe('routeFormat — bearingDeg', () => {
  it('norte/leste/sul/oeste', () => {
    expect(bearingDeg([0, 0], [0, 1])).toBeCloseTo(0);    // norte
    expect(bearingDeg([0, 0], [1, 0])).toBeCloseTo(90);   // leste
    expect(bearingDeg([0, 0], [0, -1])).toBeCloseTo(180); // sul
    expect(bearingDeg([0, 0], [-1, 0])).toBeCloseTo(270); // oeste
  });
});

describe('routeFormat — straightLine (fallback)', () => {
  it('gera n pontos reto origem→destino', () => {
    const pts = straightLine([0, 0], [4, 0], 5);
    expect(pts).toEqual([[0, 0], [1, 0], [2, 0], [3, 0], [4, 0]]);
  });
  it('n=1 não vira NaN (guard 0/0)', () => {
    expect(straightLine([2, 3], [9, 9], 1)).toEqual([[2, 3]]);
  });
});
