// Contrato único de ambiente do backend.
//
// Antes disto cada módulo lia `process.env` por conta própria, com defaults
// permissivos que só apareciam em runtime: JWT ausente derrubava a rota no
// primeiro login, CORS caía em localhost e uploads iam para um bucket sem
// credencial. Aqui a validação acontece uma vez, no boot, e produção falha
// cedo em vez de subir meio configurada.
//
// Regra de ouro das mensagens: dizem QUAL variável está errada e por quê,
// nunca o valor. O erro de boot costuma ir parar em log agregado.

export type NodeEnv = 'development' | 'test' | 'production'

export interface MinioEnv {
  readonly publicUrl?: string
  readonly accessKey?: string
  readonly secretKey?: string
  readonly bucket: string
  readonly region: string
}

export interface SmtpEnv {
  readonly host?: string
  readonly port: number
  readonly secure: boolean
  readonly user?: string
  readonly pass?: string
  readonly from?: string
}

/**
 * Retenção da Leitura bruta de telemetria. A janela é política de produto e é
 * ajustável; o piso não é. Reter menos que 48 horas apagaria Leitura de um dia
 * que ainda pode receber evento atrasado, e o Resumo daquele dia nasceria de
 * série incompleta. O piso é o mesmo prazo em que um dia monitorado fecha.
 */
export interface TelemetryRetentionEnv {
  readonly windowMs: number
  readonly batchSize: number
}

export const RETENTION_DEFAULT_DAYS = 30
export const RETENTION_MIN_DAYS = 2
/** Alguns milhares por lote: transação curta o bastante para não segurar o banco. */
export const RETENTION_DEFAULT_BATCH = 5_000

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Inteiro a partir de um mínimo, ou problema declarado. Nunca corrige em
 * silêncio: uma janela errada corrigida para o padrão esconderia a
 * configuração ruim até alguém ir procurar o dado que sumiu.
 */
function parseBoundedInt(
  raw: string | undefined,
  name: string,
  fallback: number,
  minimum: number,
  problems: string[],
): number {
  if (raw === undefined || raw === '') return fallback
  const value = Number(raw)
  if (!Number.isInteger(value) || value < minimum) {
    problems.push(`${name} precisa ser um inteiro de ao menos ${minimum}`)
    return fallback
  }
  return value
}

/**
 * Vale em todo ambiente, e não só em produção: retenção apaga dado igual na
 * máquina de quem desenvolve, e um piso que só valesse em produção deixaria
 * apagar ali o que ainda não foi resumido.
 */
export function parseTelemetryRetention(
  source: NodeJS.ProcessEnv,
  problems: string[],
): TelemetryRetentionEnv {
  const days = parseBoundedInt(
    source.TELEMETRY_RETENTION_DAYS,
    'TELEMETRY_RETENTION_DAYS',
    RETENTION_DEFAULT_DAYS,
    RETENTION_MIN_DAYS,
    problems,
  )
  const batchSize = parseBoundedInt(
    source.TELEMETRY_RETENTION_BATCH_SIZE,
    'TELEMETRY_RETENTION_BATCH_SIZE',
    RETENTION_DEFAULT_BATCH,
    1,
    problems,
  )
  return { windowMs: days * DAY_MS, batchSize }
}

export interface RuntimeEnv {
  readonly nodeEnv: NodeEnv
  readonly isProduction: boolean
  readonly databaseUrl?: string
  readonly jwtSecret?: string
  readonly port: number
  readonly listenSocket?: string
  readonly adminAppUrl?: string
  readonly corsOrigins: readonly string[]
  readonly corsProxySetsOrigin: boolean
  readonly smtp: SmtpEnv
  readonly reportToEmail?: string
  readonly minio: MinioEnv
  readonly mapboxToken?: string
  readonly weatherCron?: string
  readonly weatherScenario?: string
  readonly telemetryRetention: TelemetryRetentionEnv
  readonly simPositions: boolean
}

const DEV_CORS_ORIGIN = 'http://localhost:5173'
export const MIN_JWT_SECRET_LENGTH = 32

function isNodeEnv(value: string): value is NodeEnv {
  return value === 'development' || value === 'test' || value === 'production'
}

function splitOrigins(raw: string): string[] {
  return raw
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

// Uma origin local vale em dev, nunca em produção. Cobre localhost, 127.0.0.1
// e o loopback IPv6 em forma nua e entre colchetes.
function isLoopbackOrigin(origin: string): boolean {
  const host = origin.replace(/^[a-z]+:\/\//i, '').split('/')[0]
  const bare = host.replace(/:\d+$/, '').replace(/^\[|\]$/g, '').toLowerCase()
  return bare === 'localhost' || bare === '127.0.0.1' || bare === '::1' || bare.endsWith('.localhost')
}

function parsePort(raw: string | undefined, problems: string[]): number {
  if (raw === undefined || raw === '') return 3000
  const port = Number(raw)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    problems.push('PORT precisa ser um inteiro entre 1 e 65535')
    return 3000
  }
  return port
}

/**
 * Valida o ambiente recebido e devolve uma configuração imutável.
 * Lança com a lista completa de problemas; nunca ecoa valores.
 */
export function parseRuntimeEnv(source: NodeJS.ProcessEnv): Readonly<RuntimeEnv> {
  const problems: string[] = []

  const rawNodeEnv = source.NODE_ENV ?? 'development'
  if (!isNodeEnv(rawNodeEnv)) {
    // Sem isso, um NODE_ENV escrito errado ("prod", "staging") passaria pelas
    // checagens de produção e rodaria com os defaults de desenvolvimento.
    throw new Error(
      `Configuração de ambiente inválida:\n- NODE_ENV precisa ser development, test ou production`,
    )
  }
  const nodeEnv: NodeEnv = rawNodeEnv
  const isProduction = nodeEnv === 'production'

  const databaseUrl = source.DATABASE_URL
  if (isProduction && !databaseUrl) problems.push('DATABASE_URL é obrigatória em produção')

  const jwtSecret = source.JWT_SECRET
  if (isProduction) {
    if (!jwtSecret) problems.push('JWT_SECRET é obrigatória em produção')
    else if (jwtSecret.length < MIN_JWT_SECRET_LENGTH) {
      problems.push(`JWT_SECRET precisa ter ao menos ${MIN_JWT_SECRET_LENGTH} caracteres em produção`)
    }
  }

  const port = parsePort(source.PORT, problems)

  const rawCors = source.CORS_ORIGINS
  const corsOrigins = rawCors === undefined ? [DEV_CORS_ORIGIN] : splitOrigins(rawCors)
  if (isProduction) {
    if (corsOrigins.length === 0) problems.push('CORS_ORIGINS precisa listar ao menos uma origin em produção')
    if (corsOrigins.includes('*')) problems.push('CORS_ORIGINS não aceita curinga em produção')
    if (corsOrigins.some(isLoopbackOrigin)) problems.push('CORS_ORIGINS não aceita origin local em produção')
    if (corsOrigins.some((origin) => origin !== '*' && !origin.startsWith('https://'))) {
      problems.push('CORS_ORIGINS precisa usar https em produção')
    }
  }

  const mailFrom = source.MAIL_FROM
  const reportToEmail = source.REPORT_TO_EMAIL
  if (isProduction) {
    if (!mailFrom) problems.push('MAIL_FROM é obrigatória em produção')
    if (!reportToEmail) problems.push('REPORT_TO_EMAIL é obrigatória em produção: sem ela a moderação não recebe denúncia')
  }

  // A cadeia de credenciais da infraestrutura (role da instância) é legítima,
  // então as duas chaves ausentes passam. O que não pode é meia credencial:
  // o SDK falharia só na primeira requisição de upload.
  const accessKey = source.MINIO_ACCESS_KEY
  const secretKey = source.MINIO_SECRET_KEY
  if (accessKey && !secretKey) problems.push('MINIO_SECRET_KEY é obrigatória quando MINIO_ACCESS_KEY está definida')
  if (secretKey && !accessKey) problems.push('MINIO_ACCESS_KEY é obrigatória quando MINIO_SECRET_KEY está definida')

  const telemetryRetention = parseTelemetryRetention(source, problems)

  const smtpPort = Number(source.SMTP_PORT ?? 1025)
  if (!Number.isInteger(smtpPort) || smtpPort <= 0 || smtpPort > 65535) {
    problems.push('SMTP_PORT precisa ser um inteiro entre 1 e 65535')
  }

  if (problems.length > 0) {
    throw new Error(`Configuração de ambiente inválida:\n- ${problems.join('\n- ')}`)
  }

  return Object.freeze<RuntimeEnv>({
    nodeEnv,
    isProduction,
    databaseUrl,
    jwtSecret,
    port,
    listenSocket: source.LISTEN_SOCKET,
    adminAppUrl: source.ADMIN_APP_URL,
    corsOrigins: Object.freeze(corsOrigins),
    corsProxySetsOrigin: source.CORS_PROXY_SETS_ORIGIN === '1',
    smtp: Object.freeze<SmtpEnv>({
      host: source.SMTP_HOST,
      port: Number.isInteger(smtpPort) ? smtpPort : 1025,
      secure: source.SMTP_SECURE === 'true',
      user: source.SMTP_USER,
      pass: source.SMTP_PASS,
      from: mailFrom,
    }),
    reportToEmail,
    minio: Object.freeze<MinioEnv>({
      publicUrl: source.MINIO_PUBLIC_URL,
      accessKey,
      secretKey,
      bucket: source.MINIO_BUCKET ?? 'swi-media',
      region: source.MINIO_REGION ?? 'us-east-1',
    }),
    mapboxToken: source.MAPBOX_TOKEN,
    weatherCron: source.WEATHER_CRON,
    weatherScenario: source.WEATHER_SCENARIO,
    telemetryRetention: Object.freeze(telemetryRetention),
    simPositions: source.SIM_POSITIONS === '1',
  })
}
