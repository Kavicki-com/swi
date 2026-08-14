// Geometria PURA de mapa em metros reais. Sem efeitos, sem dependencia de
// biblioteca de mapa. Espelha o estilo de services/evacuation/routeFormat.ts.
//
// POR QUE EXISTE: pixel nao e distancia. Anel desenhado em pixels sobre a tela
// faz os rotulos "5KM"/"10KM" mentirem assim que a pessoa da zoom, e nao
// acompanha o mapa quando ela arrasta. Aqui os aneis de 5 e 10 km sao
// geometria em lat/lng, e quem projeta pra tela e o MapLibre, que ja sabe
// fazer isso em qualquer zoom.
import type { Feature, LineString } from 'geojson';

type Pt = [number, number]; // [longitude, latitude] em graus, ordem do GeoJSON

// Raio medio da Terra (IUGG). A escala do app e de quilometros numa mina, entao
// a esfera basta: a diferenca pro elipsoide WGS84 fica na casa dos centimetros.
const EARTH_RADIUS_M = 6371008.8;

const toRad = (deg: number) => (deg * Math.PI) / 180;
const toDeg = (rad: number) => (rad * 180) / Math.PI;

/**
 * Ponto a `meters` de distancia de `center`, no rumo de bussola `bearingDeg`
 * (0 = norte, 90 = leste). Formula esferica do ponto de destino.
 *
 * Nao da pra somar "x graus" nos dois eixos: um grau de latitude vale ~111 km
 * em qualquer lugar, mas um grau de longitude encolhe com cos(latitude). Somar
 * o mesmo delta nos dois desenharia uma elipse, nao um circulo.
 */
export function destinationPoint(center: Pt, bearingDeg: number, meters: number): Pt {
  const [lng, lat] = center;
  const delta = meters / EARTH_RADIUS_M; // distancia angular
  const theta = toRad(bearingDeg);
  const phi1 = toRad(lat);
  const lambda1 = toRad(lng);

  const sinPhi2 =
    Math.sin(phi1) * Math.cos(delta) + Math.cos(phi1) * Math.sin(delta) * Math.cos(theta);
  const phi2 = Math.asin(sinPhi2);
  const lambda2 =
    lambda1 +
    Math.atan2(
      Math.sin(theta) * Math.sin(delta) * Math.cos(phi1),
      Math.cos(delta) - Math.sin(phi1) * sinPhi2,
    );

  return [toDeg(lambda2), toDeg(phi2)];
}

/**
 * Anel geografico de raio `radiusMeters` em volta de `center`, como LineString
 * FECHADA (o ultimo vertice repete o primeiro) pronta pro <MapLineSource>.
 *
 * `steps` = 64 e o mesmo default que o turf usa: nessa contagem o erro da corda
 * contra o arco fica abaixo de um pixel nos zooms em que o anel cabe na tela,
 * entao o poligono le como circulo.
 */
export function circleFeature(
  center: Pt,
  radiusMeters: number,
  steps = 64,
): Feature<LineString> {
  const coordinates: Pt[] = [];
  for (let i = 0; i < steps; i++) {
    coordinates.push(destinationPoint(center, (i * 360) / steps, radiusMeters));
  }
  coordinates.push(coordinates[0]); // fecha o anel
  return {
    type: 'Feature',
    properties: { radiusMeters },
    geometry: { type: 'LineString', coordinates },
  };
}
