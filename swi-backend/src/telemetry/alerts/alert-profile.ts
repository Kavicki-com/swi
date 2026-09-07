import { FRESHNESS } from '../domain/metric-state'

// Perfil de alertas: o conjunto versionado de limites, durações e bandas com
// que uma condição foi aberta. Toda linha de condição grava a versão. Mudar
// número sem mudar versão é proibido: a auditoria compara versão para saber
// com que régua cada condição foi aberta.
//
// Constante congelada, e não variável de ambiente: limite que se ajusta sem
// passar por commit é como limiar deriva em silêncio.
//
// ADVERTÊNCIA. Estes números são experimentais e vão para calibração na mesma
// tarefa que calibra a fórmula de esforço. Em particular, 90% da máxima por
// idade sustentado por 60 s vai disparar em trabalho pesado normal: a
// varredura de parâmetros da avaliação mostrou que os funcionários sustentam
// intensidade acima da máxima por idade. Segurar o motor até ter número
// calibrado deixaria o painel em zero, e sem condição gravada não há dado
// para calibrar.

export const ALERT_PROFILE_VERSION = 'swi-alert-experimental-1'

export interface AlertProfile {
  readonly version: string
  readonly heartRateHigh: {
    /** Fração da máxima por idade (Tanaka) acima da qual abre. */
    readonly maxFraction: number
    /** Piso absoluto quando não há data de nascimento. */
    readonly floorBpm: number
    readonly hysteresisBpm: number
  }
  readonly heartRateLow: {
    /** Quantos bpm abaixo do repouso observado abre. */
    readonly belowRestingBpm: number
    /** Piso absoluto quando não há repouso observado. */
    readonly floorBpm: number
    readonly hysteresisBpm: number
  }
  /**
   * Cobertura das condições de BPM. Os três juntos definem o que conta como
   * evidência, e nenhum deles sozinho basta.
   *
   * ATENÇÃO ao calibrar: nenhum destes é a duração da persistência. Como a
   * decisão exige que TODA amostra da janela cumpra o predicado, uma leitura
   * fora do limite zera a evidência, e a condição só abre quando a janela
   * inteira já está do outro lado. A persistência efetiva é sempre windowMs.
   */
  readonly persistence: {
    /** Quanto se olha para trás do gatilho. É a persistência efetiva. */
    readonly windowMs: number
    /** Distância mínima entre a primeira e a última amostra da janela. */
    readonly minSpanMs: number
    /**
     * Vão máximo entre amostras consecutivas. Sem ele, duas amostras nas
     * pontas da janela cumpririam minSpanMs sem haver dado nenhum entre elas,
     * e duas amostras a 45 s de distância não provam 45 s de nada. Três
     * cadências de 5 s: tolera falha de entrega, não tolera silêncio.
     */
    readonly maxGapMs: number
  }
  readonly batteryLow: { readonly openAtPercent: number; readonly recoverAbovePercent: number }
  readonly bloodPressureReview: {
    readonly systolicAt: number
    readonly diastolicAt: number
    readonly systolicRecoverBelow: number
    readonly diastolicRecoverBelow: number
  }
  readonly signalLost: {
    /** Silêncio a partir do qual abre. É o prazo de obsolescência do domínio. */
    readonly silenceMs: number
    /** Silêncio além do qual o turno acabou e ninguém espera dado. */
    readonly shiftCeilingMs: number
  }
  /** Dias fechados olhados para o repouso observado. Igual ao da fórmula. */
  readonly restingDays: number
}

export const EXPERIMENTAL_ALERT_PROFILE: AlertProfile = Object.freeze({
  version: ALERT_PROFILE_VERSION,
  heartRateHigh: Object.freeze({ maxFraction: 0.9, floorBpm: 180, hysteresisBpm: 10 }),
  heartRateLow: Object.freeze({ belowRestingBpm: 15, floorBpm: 40, hysteresisBpm: 10 }),
  persistence: Object.freeze({ windowMs: 60_000, minSpanMs: 45_000, maxGapMs: 15_000 }),
  batteryLow: Object.freeze({ openAtPercent: 15, recoverAbovePercent: 25 }),
  bloodPressureReview: Object.freeze({
    systolicAt: 140,
    diastolicAt: 90,
    systolicRecoverBelow: 130,
    diastolicRecoverBelow: 85,
  }),
  // 8 h escrito aqui, e não pela constante HOUR do domínio: ela só passa a ser
  // exportada numa PR ainda não mergeada, e esta fatia não deve depender dela.
  signalLost: Object.freeze({ silenceMs: FRESHNESS.VITAL.staleMs, shiftCeilingMs: 8 * 60 * 60 * 1000 }),
  restingDays: 14,
})
