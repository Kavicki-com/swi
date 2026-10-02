// Frase do tempo até a fadiga de uma pessoa a partir do estado do aparelho
// dela. Usada onde só esse número aparece (painel de contato do chat): sem
// aparelho a frase diz isso, e nada é estimado sem leitura.
import type { PairedTelemetryState } from '@/hooks/usePairedTelemetry'
import { NO_VALUE, vitalsViewFrom } from './vitalsView'

export function pairedFatigue(state: PairedTelemetryState): {
  label: string
  sourceBadge: string | null
} {
  if (state.failed) return { label: 'Leitura indisponível no momento', sourceBadge: null }
  if (state.device === 'none') return { label: 'Sem aparelho', sourceBadge: null }
  if (state.device === 'loading' || state.telemetry === null) {
    return { label: NO_VALUE, sourceBadge: null }
  }
  const view = vitalsViewFrom(state.telemetry)
  // Quem nunca reportou não tem avaliação: a frase descreve a leitura.
  const label = state.telemetry.origin === null ? view.status : view.fatigueEta.label
  return { label, sourceBadge: view.sourceBadge }
}
