import { circleFeature, destinationPoint } from './mapGeometry';

type Pt = [number, number];

// Oraculo INDEPENDENTE: haversine escrita aqui de proposito, formula diferente
// da do modulo (que usa a do ponto de destino). Importar um `distanceBetween`
// do proprio mapGeometry seria conferir o codigo contra ele mesmo, e um erro
// no raio da Terra passaria despercebido nos dois lados.
const R = 6371008.8; // raio medio IUGG, o mesmo que o modulo assume
const rad = (d: number) => (d * Math.PI) / 180;

function metrosEntre(a: Pt, b: Pt): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Mina ficticia em Minas: hemisferio sul, longitude negativa, que e onde o app
// roda de verdade.
const CENTRO: Pt = [-43.9, -19.9];

describe('destinationPoint', () => {
  it('anda a distancia pedida, em metros, no rumo pedido', () => {
    for (const rumo of [0, 45, 90, 180, 270, 315]) {
      const p = destinationPoint(CENTRO, rumo, 5000);
      expect(metrosEntre(CENTRO, p)).toBeCloseTo(5000, 0); // ±0,5 m
    }
  });

  it('rumo 0 vai pro norte sem mexer na longitude', () => {
    const p = destinationPoint(CENTRO, 0, 5000);
    expect(p[1]).toBeGreaterThan(CENTRO[1]);
    expect(p[0]).toBeCloseTo(CENTRO[0], 9);
  });

  it('rumo 180 vai pro sul sem mexer na longitude', () => {
    const p = destinationPoint(CENTRO, 180, 5000);
    expect(p[1]).toBeLessThan(CENTRO[1]);
    expect(p[0]).toBeCloseTo(CENTRO[0], 9);
  });

  // 5 km de latitude sao ~0,045 grau em qualquer ponto do globo; 5 km de
  // longitude NAO sao, encolhem com cos(lat). Um circulo que ignora isso sai
  // deformado no eixo errado.
  it('a mesma distancia rende passo de longitude maior que o de latitude fora do equador', () => {
    const norte = destinationPoint(CENTRO, 0, 5000);
    const leste = destinationPoint(CENTRO, 90, 5000);
    const passoLat = Math.abs(norte[1] - CENTRO[1]);
    const passoLng = Math.abs(leste[0] - CENTRO[0]);
    expect(passoLng).toBeGreaterThan(passoLat);
  });
});

describe('circleFeature', () => {
  it('devolve um anel fechado de LineString com steps+1 vertices', () => {
    const f = circleFeature(CENTRO, 5000, 64);
    expect(f.geometry.type).toBe('LineString');
    expect(f.geometry.coordinates).toHaveLength(65);
    expect(f.geometry.coordinates[0]).toEqual(f.geometry.coordinates[64]);
  });

  // O CORACAO do QA Mobile #10: o anel de 5KM tem 5 km DE VERDADE, medidos em
  // metros a partir do centro, e nao um tamanho em pixels que mente conforme o
  // zoom.
  it('todo vertice fica a exatamente o raio pedido do centro', () => {
    for (const raio of [5000, 10000]) {
      const f = circleFeature(CENTRO, raio, 64);
      for (const v of f.geometry.coordinates) {
        expect(metrosEntre(CENTRO, v as Pt)).toBeCloseTo(raio, 0); // ±0,5 m
      }
    }
  });

  it('o anel de 10 km e mais largo que o de 5 km', () => {
    const cinco = circleFeature(CENTRO, 5000, 8);
    const dez = circleFeature(CENTRO, 10000, 8);
    const larguraLng = (f: ReturnType<typeof circleFeature>) => {
      const lngs = f.geometry.coordinates.map((c) => c[0]);
      return Math.max(...lngs) - Math.min(...lngs);
    };
    expect(larguraLng(dez)).toBeGreaterThan(larguraLng(cinco));
  });

  it('acompanha o centro: mudou a posicao, mudou o anel', () => {
    const outro: Pt = [-44.2, -20.1];
    const f = circleFeature(outro, 5000, 16);
    for (const v of f.geometry.coordinates) {
      expect(metrosEntre(outro, v as Pt)).toBeCloseTo(5000, 0);
    }
  });
});
