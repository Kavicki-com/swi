import { fatigueChartCondition, fatigueChartProgress } from './fatigueChart';
import { BASELINE_VITALS } from './simulator';

// Condition — cortes acordados (2026-07-07): verde acima de 1h,
// alerta entre 20min e 1h (inclusive), azul abaixo de 20min.
it('baseline (105min) -> good', () => { expect(fatigueChartCondition(BASELINE_VITALS.fatigueEtaMin)).toBe('good'); });
it('61min -> good', () => { expect(fatigueChartCondition(61)).toBe('good'); });
it('60min -> alert (1h em ponto ja e alerta)', () => { expect(fatigueChartCondition(60)).toBe('alert'); });
it('20min -> alert (borda inferior inclusa)', () => { expect(fatigueChartCondition(20)).toBe('alert'); });
it('19min -> low', () => { expect(fatigueChartCondition(19)).toBe('low'); });
it('0min -> low', () => { expect(fatigueChartCondition(0)).toBe('low'); });

// Progress — anel cheio = 240min (4h), clamp em [0,1], passos de 1%.
it('0min -> arco vazio', () => { expect(fatigueChartProgress(0)).toBe(0); });
it('240min -> anel cheio', () => { expect(fatigueChartProgress(240)).toBe(1); });
it('480min -> clamp em 1', () => { expect(fatigueChartProgress(480)).toBe(1); });
it('60min -> 0.25', () => { expect(fatigueChartProgress(60)).toBe(0.25); });
it('baseline 105min -> 0.44 (arredonda 0.4375 pra passo de 1%)', () => { expect(fatigueChartProgress(105)).toBe(0.44); });
