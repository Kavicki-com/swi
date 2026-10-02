// Monitoramento: o diretório REAL da org (admins, funcionários, relatórios), a
// telemetria de cada funcionário e a fila de alertas operacionais. As funções
// build* são puras: a tela relê os dados quando o socket avisa e recalcula a
// view a partir deles. Os tipos são o contrato que a UI consome, então mudá-los
// aqui obriga a mexer nas telas.
import type { ServiceResponse } from '@/services/types'
import type {
  MonitoringAlertDetail,
  MonitoringGoodConditionsView,
  MonitoringKpi,
  MonitoringTier,
  MonitoringUserAlert,
} from '@/services/types/monitoring'
import type { IconName } from '@kavicki/swi-design-system'
import { adminsApi, employeesApi, type Employee } from './users'
import { reportsApi } from './reports'
import {
  telemetryApi,
  type AdminTelemetrySummary,
  type AdminWorkerEntry,
  type AlertQueueItem,
  type ConditionCategory,
} from './telemetry'
import { NO_VALUE } from '@/services/vitals/vitalsView'
import { ACTIVE_CAMERAS } from '@/services/cameras'

export type {
  MonitoringAlertDetail,
  MonitoringGoodConditionsView,
  MonitoringKpi,
  MonitoringTier,
  MonitoringUserAlert,
} from '@/services/types/monitoring'

// Milhar em pt-BR: com a operação cheia os agregados passam de 6 dígitos e
// "437715" fica ilegível num card.
const num = (n: number): string => n.toLocaleString('pt-BR')

// Hora do dia quando é hoje; dia e hora quando não é, para um alerta antigo
// não parecer de agora.
function clock(iso: string): string {
  const d = new Date(iso)
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  return d.toDateString() === new Date().toDateString()
    ? time
    : `${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${time}`
}

const CATEGORY_LABEL: Record<ConditionCategory, string> = {
  URGENT: 'Urgente',
  HEALTH: 'Atenção',
  DEVICE: 'Aparelho',
}

const CATEGORY_TONE: Record<ConditionCategory, MonitoringAlertDetail['tone']> = {
  URGENT: 'error',
  HEALTH: 'warning',
  DEVICE: 'info',
}

const round = (n: number) => Math.round(n)

// Título, ícone e frase de cada tipo de condição. Sem valor gravado a frase sai
// sem número, nunca com um valor inventado.
function describe(item: AlertQueueItem): { title: string; icon: IconName; description: string } {
  const { kind, observedValue: obs, thresholdValue: thr } = item.condition
  switch (kind) {
    case 'HEART_RATE_HIGH':
    case 'HEART_RATE_LOW': {
      const side = kind === 'HEART_RATE_HIGH' ? 'acima' : 'abaixo'
      return {
        title:
          kind === 'HEART_RATE_HIGH' ? 'Frequência cardíaca alta' : 'Frequência cardíaca baixa',
        icon: 'heart_filled',
        description:
          obs !== null && thr !== null
            ? `${round(obs)} bpm, ${side} do limite de ${round(thr)} bpm`
            : `Batimento ${side} do limite configurado`,
      }
    }
    case 'WEAR_HIGH':
      return {
        title: 'Desgaste alto',
        icon: 'cognition_filled' as IconName,
        description:
          obs !== null && thr !== null
            ? `Desgaste estimado em ${round(obs)}%, limite de ${round(thr)}%`
            : 'Desgaste estimado acima do limite',
      }
    case 'BLOOD_PRESSURE_REVIEW':
      return {
        title: 'Pressão para revisar',
        icon: 'av_timer',
        description: 'A última medição de pressão pede revisão',
      }
    case 'DEVICE_BATTERY_LOW':
      return {
        title: 'Bateria do relógio baixa',
        icon: 'warning',
        description: obs !== null ? `Bateria em ${round(obs)}%` : 'Bateria abaixo do mínimo',
      }
    case 'DEVICE_SIGNAL_LOST':
      return {
        title: 'Sem sinal do relógio',
        icon: 'warning',
        description: 'O monitoramento parou de receber dados',
      }
  }
}

function triageLine(item: AlertQueueItem): string | null {
  const who = item.triagedBy ? ` por ${item.triagedBy.name}` : ''
  if (item.status === 'RESOLVED' && item.resolvedAt) {
    return `Resolvido${who} às ${clock(item.resolvedAt)}`
  }
  if (item.status === 'ACKNOWLEDGED' && item.acknowledgedAt) {
    return `Reconhecido${who} às ${clock(item.acknowledgedAt)}`
  }
  return null
}

/** Um alerta da fila como a linha do card o mostra, com o que dá para fazer com ele. */
export function alertDetailFrom(item: AlertQueueItem): MonitoringAlertDetail {
  const { title, icon, description } = describe(item)
  const notes = [
    `${CATEGORY_LABEL[item.condition.category]}, aberto às ${clock(item.condition.openedAt)}`,
  ]
  if (item.condition.recoveredAt) {
    notes.push(`Leitura já voltou ao normal às ${clock(item.condition.recoveredAt)}`)
  }
  if (item.origin === 'DEMO') notes.push('Dados de demonstração')
  return {
    id: item.id,
    icon,
    title,
    description,
    tone: CATEGORY_TONE[item.condition.category],
    notes,
    triage: {
      alertId: item.id,
      status: item.status,
      triageLine: triageLine(item),
      canAcknowledge: item.status === 'OPEN',
      canResolve: item.status === 'OPEN' || item.status === 'ACKNOWLEDGED',
    },
  }
}

const UNRESOLVED = new Set<AlertQueueItem['status']>(['OPEN', 'ACKNOWLEDGED'])

const TIER_ORDER: Record<MonitoringTier, number> = {
  'alerta-fadiga': 0,
  desgastado: 1,
  excelente: 2,
  'sem-leitura': 3,
}

// Urgência e atenção valem tanto pela condição aberta quanto pelo alerta ainda
// não triado: a condição pode ter se recuperado, mas alguém precisa olhar.
// "Excelente" exige leitura atual; sem ela a pessoa não foi avaliada.
function tierFor(
  entry: AdminWorkerEntry | undefined,
  alerts: ReadonlyArray<AlertQueueItem>,
): MonitoringTier {
  const pending = alerts.filter((a) => UNRESOLVED.has(a.status)).map((a) => a.condition.category)
  const categories = new Set([
    ...(entry?.telemetry.conditions.map((c) => c.category) ?? []),
    ...pending,
  ])
  if (categories.has('URGENT')) return 'alerta-fadiga'
  if (categories.has('HEALTH')) return 'desgastado'
  const t = entry?.telemetry
  return t && t.origin !== null && t.metrics.heartRate.quality === 'CURRENT'
    ? 'excelente'
    : 'sem-leitura'
}

/** Um card por funcionário do cadastro, na ordem urgentes, atenção, excelentes e sem leitura. */
export function buildUserAlerts(
  employees: ReadonlyArray<Employee>,
  workers: ReadonlyArray<AdminWorkerEntry> | null,
  queue: ReadonlyArray<AlertQueueItem>,
): MonitoringUserAlert[] {
  const byWorker = new Map((workers ?? []).map((w) => [w.worker.id, w]))
  const rows = employees.map((e) => {
    const alerts = queue.filter((a) => a.worker.id === e.id)
    const tier = tierFor(byWorker.get(e.id), alerts)
    return {
      id: e.id,
      name: e.name,
      age: e.age,
      bloodType: e.bloodType,
      role: e.role,
      specialization: e.specialization,
      avatarUri: e.avatarUri,
      active: e.active ?? true,
      tier,
      alerts: alerts.map(alertDetailFrom),
    }
  })
  return rows.sort(
    (a, b) => TIER_ORDER[a.tier] - TIER_ORDER[b.tier] || a.name.localeCompare(b.name, 'pt-BR'),
  )
}

export type KpiInput = {
  admins: number
  workers: number
  pendingReports: number
  /** Quantos estão na aba de alerta agora: o mesmo número do badge da régua. */
  fatigueCount: number
  summary: AdminTelemetrySummary | null
}

export function buildKpis(input: KpiInput): MonitoringKpi[] {
  const pressure = input.summary?.bloodPressureAverage.value ?? null
  const movements = input.summary?.movements.value ?? null
  return [
    {
      id: 'admins',
      icon: 'account_circle_filled',
      value: String(input.admins),
      label: 'Administradores',
    },
    {
      id: 'workers',
      icon: 'person_apron_filled',
      value: String(input.workers),
      label: 'Funcionários',
    },
    {
      id: 'reports',
      icon: 'report_filled',
      value: String(input.pendingReports),
      label: 'Novos relatórios',
    },
    // Câmeras: conta a MESMA frota que o mapa desenha (services/cameras).
    {
      id: 'cameras',
      icon: 'video_camera_filled',
      value: num(ACTIVE_CAMERAS),
      label: 'Câmeras ativas',
    },
    {
      id: 'fatigue',
      icon: 'bell_filled',
      value: String(input.fatigueCount),
      label: 'Alertas de fadiga',
    },
    {
      id: 'pressure',
      icon: 'favorite_filled',
      value: pressure ? `${pressure.systolic}/${pressure.diastolic}` : NO_VALUE,
      label: 'Pressão arterial média',
    },
    // Passos somados do dia: é o que o backend chama de movimentos.
    {
      id: 'movements',
      icon: 'directions_walk',
      value: movements === null ? NO_VALUE : num(movements),
      label: 'Movimentos realizados',
    },
  ]
}

const pct = (part: number, whole: number) => (whole > 0 ? round((part / whole) * 100) : 0)

/**
 * Os 4 donuts das boas condições. O arco do batimento mostra quanto da equipe
 * tem leitura atual, porque uma média de bpm não tem "porcentagem cheia".
 */
export function buildGoodConditions(
  summary: AdminTelemetrySummary | null,
  failed: boolean,
): MonitoringGoodConditionsView {
  if (!summary) {
    const caption = failed ? 'Leitura indisponível no momento' : 'Sem dados atuais'
    const empty = (label: string) => ({ value: NO_VALUE, label, caption, progress: 0 })
    return {
      vitals: empty('Funcionários'),
      fatigueRate: empty(''),
      heartrate: empty('BPM'),
      urgentAlerts: empty('Funcionários'),
    }
  }
  const { vitalSigns, wearRate, heartRateAverage, urgentAlerts } = summary
  return {
    vitals: {
      value: vitalSigns.value === null ? NO_VALUE : String(vitalSigns.value),
      label: 'Funcionários',
      caption: vitalSigns.caption,
      progress: vitalSigns.value === null ? 0 : pct(vitalSigns.value, vitalSigns.coverage.total),
    },
    fatigueRate: {
      value: wearRate.value === null ? NO_VALUE : `${round(wearRate.value)}%`,
      label: '',
      caption: wearRate.caption,
      progress: wearRate.value === null ? 0 : Math.min(100, Math.max(0, round(wearRate.value))),
    },
    heartrate: {
      value: heartRateAverage.value === null ? NO_VALUE : String(round(heartRateAverage.value)),
      label: 'BPM',
      caption: heartRateAverage.caption,
      progress: pct(heartRateAverage.coverage.evaluated, heartRateAverage.coverage.total),
    },
    urgentAlerts: {
      value: String(urgentAlerts.workers),
      label: 'Funcionários',
      caption: urgentAlerts.caption,
      progress: pct(urgentAlerts.workers, urgentAlerts.total),
    },
  }
}

export type MonitoringDirectory = {
  admins: number
  pendingReports: number
  employees: ReadonlyArray<Employee>
}

export const monitoringApi = {
  // Cadastro da org. Falha degrada para listas vazias: o monitoramento continua
  // de pé mostrando o que der, em vez de quebrar a tela inteira.
  async directory(): Promise<ServiceResponse<MonitoringDirectory>> {
    const [admins, reports, employees] = await Promise.all([
      adminsApi.list(),
      reportsApi.list(),
      employeesApi.list(),
    ])
    return {
      data: {
        admins: admins.data?.length ?? 0,
        pendingReports: (reports.data ?? []).filter((r) => r.status === 'pending').length,
        employees: employees.data ?? [],
      },
      error: null,
    }
  },

  // Alertas que ainda pedem triagem. Falha chega como erro: uma fila vazia
  // afirmaria que não há nada a fazer.
  async queue(): Promise<ServiceResponse<AlertQueueItem[]>> {
    const { data, error } = await telemetryApi.alerts({ status: ['OPEN', 'ACKNOWLEDGED'] })
    if (error || !data) {
      return { data: null, error: error ?? { message: 'Falha ao carregar os alertas' } }
    }
    return { data: data.items, error: null }
  },
}
