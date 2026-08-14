import { useAuth } from '@/hooks/useAuth'
import { simulatedVitalsFor } from '@/services/vitals/simulatedVitals'

/**
 * Vitais do usuário LOGADO pro widget do header.
 *
 * Com um literal por tela (`user?.bpm ?? 99`, `'12/8'`), o header afirma o mesmo
 * bpm para qualquer admin e contradiz a página de detalhe do MESMO admin. Aqui
 * o valor sai do mesmo gerador determinístico das demais superfícies: mesma
 * pessoa, mesmo número, em todo lugar.
 */
export function useMyVitals(): { bpm: number; pressure: string; progress: number } {
  const { user } = useAuth()
  // Sem sessão o header nem renderiza; o id vazio mantém a função total.
  const v = simulatedVitalsFor(user?.id ?? 'anon', Date.now())
  return { bpm: v.bpm, pressure: v.pressure, progress: v.fatiguePct }
}
