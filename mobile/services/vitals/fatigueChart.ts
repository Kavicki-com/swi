import type { WorkerStatus } from './types';

// Derivação EXCLUSIVA do StatusChart do dashboard: condição (cor) e arco de
// progresso dirigidos pelo tempo até a fadiga (fatigueEtaMin — o mesmo dado
// do "Fadiga em:" exibido logo abaixo do chart). Decisão de design 2026-07-07
// (variantes Figma 304:2356): o chart conta a história da FADIGA; o status
// composto de segurança (deriveStatus: oxigenação + BPM + fadiga%) continua
// sendo a fonte do pin do trabalhador no mapa.

export type FatigueChartCondition = Exclude<WorkerStatus, 'unknown'>;

/** Acima disso (exclusivo) a condição é 'good' (verde). */
export const FATIGUE_GOOD_ABOVE_MIN = 60;
/** Abaixo disso (exclusivo) a condição é 'low' (azul, exausto); entre os dois cortes, 'alert' (vermelho). */
export const FATIGUE_LOW_BELOW_MIN = 20;
/** Anel cheio do arco = 4h até a fadiga. Baseline do simulador (105min) desenha ~44% de arco, compatível com o desenho das variantes no Figma. */
export const FATIGUE_FULL_RING_MIN = 240;

export function fatigueChartCondition(fatigueEtaMin: number): FatigueChartCondition {
  if (fatigueEtaMin < FATIGUE_LOW_BELOW_MIN) return 'low';
  if (fatigueEtaMin <= FATIGUE_GOOD_ABOVE_MIN) return 'alert';
  return 'good';
}

// Arredondado a passos de 1%: deltas de arco sub-1% são invisíveis, e o
// arredondamento mantém as props do StatusChart memoizado estáveis quando o
// jitter do simulador (±3min/tick) não move o arco de verdade.
export function fatigueChartProgress(fatigueEtaMin: number): number {
  const raw = fatigueEtaMin / FATIGUE_FULL_RING_MIN;
  return Math.round(Math.min(1, Math.max(0, raw)) * 100) / 100;
}
