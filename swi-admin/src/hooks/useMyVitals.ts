import { useAuth } from '@/hooks/useAuth'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

/**
 * Vitais do usuário LOGADO pro widget do header.
 *
 * Antes cada tela caía num literal diferente (`user?.bpm ?? 99`, `'12/8'`), então
 * o header afirmava 99 bpm pra qualquer admin — inclusive contradizendo o que a
 * página de detalhe do MESMO admin mostrava. Agora sai do mesmo gerador
 * determinístico das demais superfícies: mesma pessoa, mesmo número, em todo
 * lugar (QA de volume 2026-07-26).
 */
export function useMyVitals(): { bpm: number; pressure: string; progress: number } {
  const { user } = useAuth()
  // Sem sessão o header nem renderiza; o id vazio mantém a função total.
  const v = simulatedVitalsFor(user?.id ?? 'anon', Date.now())
  return { bpm: v.bpm, pressure: v.pressure, progress: v.fatiguePct }
}
