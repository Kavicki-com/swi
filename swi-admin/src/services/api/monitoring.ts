// Monitoramento HONESTO (Fase 3): os cards derivam do diretório REAL da org
// (admins/funcionários/relatórios) com vitais SIMULADOS plausíveis por worker
// (rotulados na UI via SimulatedDataBadge) — aposenta o roster fake. Contrato
// (tipos) preservado do mock pra UI não mudar.
import type { MockResponse } from '@/services/mockApi/types'
import type {
  MonitoringAlertDetail,
  MonitoringGoodConditionsStats,
  MonitoringKpi,
  MonitoringUserAlert,
} from '@/services/mockApi/monitoring'
import type { IconName } from '@kavicki/swi-design-system'
import { adminsApi, employeesApi, type Employee } from './users'
import { reportsApi } from './reports'
import { simulatedVitalsFor, type SimulatedVitals } from '@/services/vitals/simulatedVitals'
import { ACTIVE_CAMERAS } from '@/services/cameras'

export type {
  MonitoringAlertDetail,
  MonitoringGoodConditionsStats,
  MonitoringKpi,
  MonitoringUserAlert,
} from '@/services/mockApi/monitoring'

// Câmeras: conta a MESMA frota que o mapa desenha (services/cameras). Era '564'
// fixo enquanto o mapa mostrava 12 pinos — o painel afirmava câmera inexistente.

// Milhar em pt-BR: com a operação cheia os agregados passam de 6 dígitos e
// "437715" fica ilegível num card (QA de volume 2026-07-26).
const num = (n: number): string => n.toLocaleString('pt-BR')

type WithVitals = { w: Employee; v: SimulatedVitals }

async function population(): Promise<WithVitals[]> {
  const employees = await employeesApi.list()
  const now = Date.now()
  return (employees.data ?? []).map((w) => ({ w, v: simulatedVitalsFor(w.id, now) }))
}

// Pressão média da população ("12/8"): média das sistólicas/diastólicas
// simuladas — plausível e coerente com os cards individuais.
function averagePressure(pop: WithVitals[]): string {
  if (pop.length === 0) return '12/8'
  let sys = 0,
    dia = 0
  for (const { v } of pop) {
    const [s, d] = v.pressure.split('/')
    sys += Number(s)
    dia += Number(d)
  }
  return `${Math.round(sys / pop.length)}/${Math.round(dia / pop.length)}`
}

const averageBpm = (pop: WithVitals[]): number =>
  pop.length === 0 ? 80 : Math.round(pop.reduce((s, { v }) => s + v.bpm, 0) / pop.length)

// Alertas por tier — descrições citam os PRÓPRIOS valores simulados do worker
// (nada de números soltos que contradizem o card).
function alertsFor(v: SimulatedVitals): ReadonlyArray<MonitoringAlertDetail> {
  if (v.tier === 'alerta-fadiga') {
    return [
      {
        id: 'sim-bpm',
        icon: 'heart_filled',
        title: 'Frequência cardíaca crítica',
        description: `${v.bpm} bpm — limite recomendado: 100 bpm`,
        tone: 'error',
      },
      {
        id: 'sim-fatigue',
        icon: 'cognition_filled' as IconName,
        title: 'Fadiga acumulada',
        description: `${v.fatigueMinutes} min até fadiga total — desgaste em ${v.fatiguePct}%`,
        tone: 'error',
      },
    ]
  }
  if (v.tier === 'desgastado') {
    return [
      {
        id: 'sim-pressure',
        icon: 'av_timer',
        title: 'Tensão arterial elevada',
        description: `Pressão ${v.pressure} — desgaste em ${v.fatiguePct}%`,
        tone: 'warning',
      },
    ]
  }
  return []
}

export const monitoringApi = {
  async kpis(): Promise<MockResponse<ReadonlyArray<MonitoringKpi>>> {
    const [admins, reports, pop] = await Promise.all([
      adminsApi.list(),
      reportsApi.list(),
      population(),
    ])
    const fatigueCount = pop.filter(({ v }) => v.tier === 'alerta-fadiga').length
    // Movimentos: agregado plausível derivado do esforço simulado da população.
    const movements = pop.reduce((s, { v }) => s + v.effortPct * 137, 0)
    const kpis: MonitoringKpi[] = [
      {
        id: 'admins',
        icon: 'account_circle_filled',
        value: String(admins.data?.length ?? 0),
        label: 'Administradores',
      },
      {
        id: 'workers',
        icon: 'person_apron_filled',
        value: String(pop.length),
        label: 'Funcionários',
      },
      {
        id: 'reports',
        icon: 'report_filled',
        value: String((reports.data ?? []).filter((r) => r.status === 'pending').length),
        label: 'Novos relatórios',
      },
      {
        id: 'cameras',
        icon: 'video_camera_filled',
        value: num(ACTIVE_CAMERAS),
        label: 'Câmeras ativas',
      },
      {
        id: 'fatigue',
        icon: 'bell_filled',
        value: String(fatigueCount),
        label: 'Alertas de fadiga',
      },
      {
        id: 'pressure',
        icon: 'favorite_filled',
        value: averagePressure(pop),
        label: 'Pressão arterial média',
      },
      {
        id: 'movements',
        icon: 'directions_walk',
        value: num(movements),
        label: 'Movimentos realizados',
      },
    ]
    return { data: kpis, error: null }
  },

  async alertUsers(): Promise<MockResponse<ReadonlyArray<MonitoringUserAlert>>> {
    const pop = await population()
    // Fadiga primeiro (cards expandidos no topo), depois desgaste, depois ok.
    const order = { 'alerta-fadiga': 0, desgastado: 1, excelente: 2 } as const
    const rows = [...pop]
      .sort((a, b) => order[a.v.tier] - order[b.v.tier])
      .map(({ w, v }) => ({
        id: w.id,
        name: w.name,
        age: w.age,
        bloodType: w.bloodType,
        role: w.role,
        specialization: w.specialization,
        avatarUri: w.avatarUri,
        active: true,
        // Tier explícito pra régua de abas filtrar sem re-derivar do `tone`
        // dos alertas (o tier é a fonte; o alerta é consequência dele).
        tier: v.tier,
        alerts: alertsFor(v),
      }))
    return { data: rows, error: null }
  },

  async goodConditionsStats(): Promise<MockResponse<MonitoringGoodConditionsStats>> {
    const pop = await population()
    const excellent = pop.filter(({ v }) => v.tier === 'excelente').length
    const avgFatigue =
      pop.length === 0 ? 0 : Math.round(pop.reduce((s, { v }) => s + v.fatiguePct, 0) / pop.length)
    return {
      data: {
        vitals: {
          value: excellent,
          label: 'Funcionários',
          progress: pop.length === 0 ? 0 : Math.round((excellent / pop.length) * 100),
        },
        fatigueRate: {
          value: `${avgFatigue}%`,
          label: avgFatigue < 40 ? 'Desgaste baixo' : 'Desgaste elevado',
          progress: avgFatigue,
        },
        heartrate: { value: averageBpm(pop), unit: 'bpm', label: 'Média da equipe' },
        urgentAlerts: {
          value: pop.filter(({ v }) => v.tier === 'alerta-fadiga').length,
          label: 'Necessitam notificação',
        },
      },
      error: null,
    }
  },
}
