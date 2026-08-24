// vitest globals (describe/it/expect/vi) via globals: true — importar de
// 'vitest' duplicaria a instância e quebraria o registro do suite.
import { rankRescueCandidates } from './rescue'
import type { DashboardMapMarker } from './dashboard'
import type { Employee } from './users'

const marker = (id: string, lat: number, lng: number): DashboardMapMarker => ({
  id,
  name: `W ${id}`,
  lat,
  lng,
  status: 'good',
  avatarUri: '',
})

const employee = (id: string, name: string): Employee => ({
  id,
  name,
  age: 40,
  bloodType: 'A+',
  role: 'Operador',
  specialization: 'Setor Leste',
  avatarUri: `av-${id}`,
  sector: 'Setor Leste',
  vitalsStatus: 'good',
  active: true,
})

// Ferido em (-23.550, -46.630). Próximo ~110 m ao norte; distante ~1,1 km.
const INJURED = marker('ferido', -23.55, -46.63)
const PERTO = marker('perto', -23.549, -46.63)
const LONGE = marker('longe', -23.54, -46.63)

describe('rankRescueCandidates', () => {
  it('exclui o próprio ferido e ordena do mais próximo ao mais distante', () => {
    const out = rankRescueCandidates(
      'ferido',
      [INJURED, LONGE, PERTO],
      [employee('ferido', 'Ferido'), employee('perto', 'Perto'), employee('longe', 'Longe')],
    )
    expect(out.map((c) => c.id)).toEqual(['perto', 'longe'])
    expect(out[0]!.distanceKm).toBeLessThan(out[1]!.distanceKm)
  })

  it('marca UMA melhor opção — o mais próximo', () => {
    const out = rankRescueCandidates('ferido', [INJURED, LONGE, PERTO], [])
    expect(out.filter((c) => c.isBestOption)).toHaveLength(1)
    expect(out.find((c) => c.isBestOption)?.id).toBe('perto')
  })

  it('ETA cresce com a distância e nunca é zero (caminhada de 1,4 m/s)', () => {
    const out = rankRescueCandidates('ferido', [INJURED, LONGE, PERTO], [])
    expect(out[0]!.etaMinutes).toBeGreaterThanOrEqual(1)
    expect(out[1]!.etaMinutes).toBeGreaterThan(out[0]!.etaMinutes)
  })

  it('usa nome/idade/sangue/avatar do DIRETÓRIO quando o funcionário existe lá', () => {
    const out = rankRescueCandidates('ferido', [INJURED, PERTO], [employee('perto', 'Maria Souza')])
    expect(out[0]).toMatchObject({ name: 'Maria Souza', bloodType: 'A+', avatarUri: 'av-perto' })
  })

  it('sem posição conhecida ninguém entra na lista (não inventa socorrista)', () => {
    expect(rankRescueCandidates('ferido', [INJURED], [employee('x', 'Sem posição')])).toEqual([])
  })

  it('ferido sem posição → lista vazia (não dá pra ranquear distância)', () => {
    expect(rankRescueCandidates('desconhecido', [PERTO, LONGE], [])).toEqual([])
  })
})
