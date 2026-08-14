// VITAIS SIMULADOS: plausíveis e ROTULADOS como simulados.
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

export interface SimulatedCaloriePoint {
  time: string
  kcal: number
}

// Arrays mutáveis de propósito: o LineCaloriesChart do DS declara
// `points: LineCaloriesPoint[]` e um ReadonlyArray não é atribuível a ele.
export interface SimulatedCalories {
  today: SimulatedCaloriePoint[]
  week: SimulatedCaloriePoint[]
  month: SimulatedCaloriePoint[]
}

// Formato da curva por período, horários/rótulos especificados. Os kcal
// aqui são a FORMA (turno começa forte, cai no fim); a magnitude por pessoa sai
// de simulatedCaloriesFor.
const CALORIE_SHAPE = {
  today: [
    ['07:15', 41],
    ['08:42', 57],
    ['10:51', 62],
    ['14:22', 38],
    ['16:33', 55],
    ['18:54', 49],
    ['19:00', 22],
    ['19:30', 19],
  ],
  week: [
    ['Seg', 312],
    ['Ter', 285],
    ['Qua', 340],
    ['Qui', 298],
    ['Sex', 365],
    ['Sáb', 180],
    ['Dom', 95],
  ],
  month: [
    ['Sem 1', 1820],
    ['Sem 2', 2010],
    ['Sem 3', 1950],
    ['Sem 4', 2180],
  ],
} as const satisfies Record<string, ReadonlyArray<readonly [string, number]>>

/**
 * Gasto calórico simulado POR PESSOA. Com uma curva constante, o detalhe do
 * worker, o do admin e o perfil próprio exibiriam os mesmos valores nos mesmos
 * horários, que é o tipo de "número confiante que não é de ninguém" que o
 * painel evita em toda superfície.
 *
 * Determinístico pelo id (sem componente temporal): o gráfico não pode
 * redesenhar a cada render. Preserva a forma especificada e escala a magnitude em
 * ±30%, com jitter por ponto pra curva não virar a mesma silhueta multiplicada.
 */
export function simulatedCaloriesFor(seed: string): SimulatedCalories {
  const h = hash(seed)
  // 0.70 … 1.30 em passos de 0.01.
  const scale = 0.7 + (h % 61) / 100
  const build = (
    points: ReadonlyArray<readonly [string, number]>,
    salt: number,
  ): SimulatedCaloriePoint[] =>
    points.map(([time, base], i) => {
      // ±12% por ponto — quebra a silhueta sem desfigurar o formato.
      const wobble = 0.88 + (hash(`${seed}:${salt}:${i}`) % 25) / 100
      return { time, kcal: Math.max(1, Math.round(base * scale * wobble)) }
    })
  return {
    today: build(CALORIE_SHAPE.today, 1),
    week: build(CALORIE_SHAPE.week, 2),
    month: build(CALORIE_SHAPE.month, 3),
  }
}
