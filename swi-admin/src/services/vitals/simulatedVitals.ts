// VITAIS SIMULADOS — plausíveis e ROTULADOS (Fase 3: monitoramento honesto).
//
// Até a smartband existir, biometria não tem fonte real. Em vez de fixtures
// quebradas (0 bpm + "excelente", O+ universal), cada worker REAL ganha vitais
// plausíveis derivados deterministicamente do id + janela de 5 min: estáveis
// dentro da janela (sem flicker), variando ao longo do dia (parece vivo), sem
// Math.random (testável). TODA superfície que mostra estes valores exibe o
// selo "Dados simulados" (components/SimulatedDataBadge).

export type SimulatedTier = 'excelente' | 'desgastado' | 'alerta-fadiga'

export interface SimulatedVitals {
  bpm: number
  pressure: string // "12/8"
  fatiguePct: number // 0-100 (progresso de desgaste)
  effortPct: number // 0-100
  fatigueMinutes: number // minutos até fadiga total
  tier: SimulatedTier
  statusLabel: string
}

export const SIMULATED_DATA_LABEL = 'Dados simulados'

const WINDOW_MS = 5 * 60_000

// FNV-1a 32-bit — determinístico e barato; espalha bem strings curtas.
function hash(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

const pick = <T>(arr: readonly T[], n: number): T => arr[n % arr.length]!

// Pressões plausíveis por tier (sistólica/diastólica típicas).
const PRESSURE_BY_TIER: Record<SimulatedTier, readonly string[]> = {
  excelente: ['11/7', '12/8', '12/7'],
  desgastado: ['13/8', '13/9', '14/9'],
  'alerta-fadiga': ['15/10', '16/10', '17/11'],
}

const LABEL_BY_TIER: Record<SimulatedTier, string> = {
  excelente: 'Condições excelentes',
  desgastado: 'Desgaste moderado',
  'alerta-fadiga': 'Alerta de fadiga',
}

export function simulatedVitalsFor(workerId: string, nowMs: number): SimulatedVitals {
  const bucket = Math.floor(nowMs / WINDOW_MS)
  const h = hash(`${workerId}:${bucket}`)
  // Tier estável por worker (independe da janela): a distribuição da equipe
  // não deve embaralhar a cada 5 min — só os valores dentro do tier variam.
  const tierRoll = hash(workerId) % 10
  const tier: SimulatedTier =
    tierRoll < 5 ? 'excelente' : tierRoll < 8 ? 'desgastado' : 'alerta-fadiga'

  const jitter = (span: number, salt: number) => hash(`${h}:${salt}`) % span

  let bpm: number, fatiguePct: number
  if (tier === 'excelente') {
    bpm = 62 + jitter(34, 1) // 62-95
    fatiguePct = 5 + jitter(30, 2) // 5-34
  } else if (tier === 'desgastado') {
    bpm = 98 + jitter(16, 1) // 98-113
    fatiguePct = 40 + jitter(30, 2) // 40-69
  } else {
    bpm = 118 + jitter(24, 1) // 118-141
    fatiguePct = 72 + jitter(24, 2) // 72-95
  }

  return {
    bpm,
    pressure: pick(PRESSURE_BY_TIER[tier], jitter(97, 3)),
    fatiguePct,
    effortPct: Math.min(100, fatiguePct + jitter(15, 4)),
    // Quanto maior a fadiga, menos minutos restam (piso 20 min no pior caso).
    fatigueMinutes: Math.max(20, 480 - fatiguePct * 4 - jitter(40, 5)),
    tier,
    statusLabel: LABEL_BY_TIER[tier],
  }
}
