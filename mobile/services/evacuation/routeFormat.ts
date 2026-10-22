// Lógica PURA de geometria da rota de evacuação (âncoras das chips, seta de
// navegação, feature da linha, aviso da rota). Sem efeitos. Espelha o estilo de
// weatherFormat.ts. Lifted das telas evacuation.tsx / evacuation-ongoing.tsx
// (DRY entre idle + ongoing).
import type { Feature, LineString } from 'geojson';
import type { RouteSnapshot } from './types';
import type { RouteErrorKind } from './EvacuationProvider';

type Pt = [number, number];

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(Math.max(v, lo), hi);
}

// Índices a 35% / 70% do array (onde as 2 time chips ancoram).
export function chipAnchors(waypoints: Pt[]): { a: Pt; b: Pt } | null {
  if (waypoints.length === 0) return null;
  const i1 = clamp(Math.floor(waypoints.length * 0.35), 0, waypoints.length - 1);
  const i2 = clamp(Math.floor(waypoints.length * 0.7), 0, waypoints.length - 1);
  return { a: waypoints[i1], b: waypoints[i2] };
}

// Rótulo de tempo das chips ancoradas ao longo da rota. O número sai da
// duração real que o RouteSnapshot traz do provedor, nunca de valor fixo.
// `fraction` é a mesma posição em que a chip ancora (0.35 / 0.7), então o
// resultado é o tempo acumulado até ali.
export function chipEtaLabel(durationSec: number | null | undefined, fraction: number): string {
  if (!durationSec || durationSec <= 0) return '—';
  const minutes = Math.max(1, Math.round((durationSec * fraction) / 60));
  return `${minutes} ${minutes === 1 ? 'minuto' : 'minutos'}`;
}

// Seta de navegação a ~30% da rota, rotacionada pro próximo waypoint.
export function navArrow(waypoints: Pt[]): { at: Pt; rotation: number } | null {
  if (waypoints.length < 2) return null;
  const idx = clamp(Math.floor(waypoints.length * 0.3), 0, waypoints.length - 2);
  const at = waypoints[idx];
  const next = waypoints[idx + 1] ?? waypoints[idx];
  return { at, rotation: bearingDeg(at, next) };
}

export function lineFeature(waypoints: Pt[]): Feature<LineString> | null {
  if (waypoints.length === 0) return null;
  return { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: waypoints } };
}

// Bearing bússola em graus de `a` pra `b`. Aproximação plana (erro desprezível na
// escala urbana ~1.5km). SVG aponta pra CIMA em rotation 0 (norte).
export function bearingDeg(a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angleEastFromX = (Math.atan2(dy, dx) * 180) / Math.PI;
  let deg = 90 - angleEastFromX;
  deg = ((deg % 360) + 360) % 360;
  return deg;
}

// Seta de navegação onde a pessoa ESTÁ (GPS), apontando pro waypoint seguinte
// ao vértice mais próximo dela. No último vértice o alvo seria ele mesmo, então
// a seta herda o rumo do último trecho.
export function navArrowAt(at: Pt, waypoints: Pt[]): { at: Pt; rotation: number } | null {
  if (waypoints.length < 2) return null;
  let nearest = 0;
  let best = Infinity;
  for (let i = 0; i < waypoints.length; i++) {
    const d = (waypoints[i][0] - at[0]) ** 2 + (waypoints[i][1] - at[1]) ** 2;
    if (d < best) { best = d; nearest = i; }
  }
  const last = waypoints.length - 1;
  if (nearest === last) return { at, rotation: bearingDeg(waypoints[last - 1], waypoints[last]) };
  return { at, rotation: bearingDeg(at, waypoints[nearest + 1]) };
}

// Aviso da rota pra tela. Erro nunca vem com traçado (o provider apaga a rota),
// então cada motivo precisa de uma frase que diga o que fazer.
export function routeNotice(
  route: RouteSnapshot | null,
  errorKind: RouteErrorKind,
): { variant: 'warning' | 'error'; text: string } | null {
  if (errorKind === 'no-evacuation') {
    return { variant: 'error', text: 'Nenhuma evacuação em andamento com ponto de encontro.' };
  }
  if (errorKind === 'no-position') {
    return { variant: 'error', text: 'Ative a localização para traçar a rota.' };
  }
  if (errorKind === 'failed') {
    return { variant: 'error', text: 'Não foi possível traçar a rota. Siga as orientações do gestor.' };
  }
  if (route?.approximate) {
    return { variant: 'warning', text: 'Rota aproximada: siga as orientações do gestor.' };
  }
  return null;
}
