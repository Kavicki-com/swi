// Rótulo de uma métrica sem valor, o mesmo que o app mostra no celular. Quem
// decide se ela está aguardando ou se a pulseira não a envia é o backend
// (`ausencia`); aqui só se escolhe a frase. Sem ausência (nula, ou o campo
// ausente de um backend anterior), não há rótulo e a tela mantém o traço.
import type { AbsentMetricState } from '@/services/api/telemetry'

export type AbsentMetric = 'heartRate' | 'steps' | 'energy' | 'oxygen' | 'pressure'

/** Contínuas são lidas; pontuais (pressão, oxigenação) são medidas. */
const AWAITING: Record<AbsentMetric, string> = {
  heartRate: 'Aguardando leitura',
  steps: 'Aguardando leitura',
  energy: 'Aguardando leitura',
  oxygen: 'Aguardando medição',
  pressure: 'Aguardando medição',
}

const NAME: Record<AbsentMetric, string> = {
  heartRate: 'batimento',
  steps: 'passos',
  energy: 'energia',
  oxygen: 'oxigenação',
  pressure: 'pressão',
}

export function absenceLabelOf(
  metric: AbsentMetric,
  state: Pick<AbsentMetricState<unknown>, 'value' | 'ausencia'>,
): string | null {
  // Com valor não há ausência, mesmo que o campo venha preenchido.
  if (state.value !== null) return null
  if (state.ausencia === 'AWAITING') return AWAITING[metric]
  if (state.ausencia === 'NOT_SENT') return `Esta pulseira não envia ${NAME[metric]}`
  return null
}
