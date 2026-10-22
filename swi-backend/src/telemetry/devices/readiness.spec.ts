import { activePathsOf, readinessColumnsOf, readinessReportOf, readinessStepsOf, type ReadinessReport } from './readiness'

// Bordas da derivação do relato de prontidão que a rota não fixa: fato não
// informado nunca ativa caminho nem vira pendência. O caminho feliz e as
// combinações principais moram no e2e (test/telemetry-readiness.e2e-spec.ts).

const SYNC = new Date('2026-10-22T13:00:00.000Z')

const relato = (
  hc: Partial<ReadinessReport['healthConnect']> = {},
  bt: Partial<ReadinessReport['bluetooth']> = {},
): ReadinessReport => ({
  healthConnect: {
    availability: 'AVAILABLE',
    readGranted: true,
    backgroundGranted: true,
    manufacturerPackage: 'com.mi.health',
    lastSyncAt: SYNC,
    lastFailure: null,
    ...hc,
  },
  bluetooth: { bandChosen: true, listenerState: 'CONNECTED', listenerStateSince: null, lastReadingAt: null, ...bt },
})

describe('activePathsOf', () => {
  it.each<[string, ReadinessReport | null, string[]]>([
    ['sem relato, nenhum', null, []],
    ['leitura não informada não ativa o Health Connect', relato({ readGranted: null }), ['BLUETOOTH']],
    ['leitura permitida sem sincronização não ativa o Health Connect', relato({ lastSyncAt: null }), ['BLUETOOTH']],
    ['escuta de estado não informado não ativa o Bluetooth', relato({}, { listenerState: null }), ['HEALTH_CONNECT']],
    ['pulseira não informada não ativa o Bluetooth', relato({}, { bandChosen: null }), ['HEALTH_CONNECT']],
    ['procurando a pulseira escolhida conta como ativo', relato({}, { listenerState: 'SEARCHING' }), ['HEALTH_CONNECT', 'BLUETOOTH']],
  ])('%s', (_caso, report, esperado) => {
    expect(activePathsOf(report)).toEqual(esperado)
  })
})

describe('readinessStepsOf', () => {
  const pendentes = (report: ReadinessReport | null, hasBirthDate = true) =>
    Object.fromEntries(readinessStepsOf(report, hasBirthDate).map((step) => [step.id, step.pendente]))

  it('Health Connect ausente é passo de instalar pendente', () => {
    expect(pendentes(relato({ availability: 'UNAVAILABLE' })).HEALTH_CONNECT_INSTALL).toBe(true)
  })

  it('disponibilidade não informada sai como não informada, não como pendente', () => {
    expect(pendentes(relato({ availability: null })).HEALTH_CONNECT_INSTALL).toBeNull()
  })

  it('pacote nulo num relato é pendência opcional; sem relato, não informado', () => {
    expect(pendentes(relato({ manufacturerPackage: null })).MANUFACTURER_APP).toBe(true)
    expect(pendentes(null).MANUFACTURER_APP).toBeNull()
  })

  it('a data de nascimento vem do perfil, com ou sem relato', () => {
    expect(pendentes(null, false).BIRTH_DATE).toBe(true)
    expect(pendentes(relato(), false).BIRTH_DATE).toBe(true)
    expect(pendentes(null, true).BIRTH_DATE).toBe(false)
  })

  it('opcionais marcados como tais, o resto obrigatório', () => {
    const opcionais = readinessStepsOf(null, true)
      .filter((step) => !step.obrigatorio)
      .map((step) => step.id)
    expect(opcionais).toEqual(['MANUFACTURER_APP', 'BLUETOOTH_BAND'])
  })
})

describe('readinessColumnsOf e readinessReportOf', () => {
  const AGORA = new Date('2026-10-22T13:20:00.000Z')

  it('o relato volta como foi mandado, com as datas como instantes', () => {
    const columns = readinessColumnsOf(
      {
        healthConnect: {
          availability: 'AVAILABLE',
          lastFailure: { reason: 'OTHER', at: '2026-10-22T13:15:00.000Z' },
        },
        bluetooth: { lastReadingAt: '2026-10-22T13:01:00.000Z' },
      },
      AGORA,
    )

    expect(columns.readinessReportedAt).toEqual(AGORA)
    expect(readinessReportOf(columns)).toEqual({
      healthConnect: {
        availability: 'AVAILABLE',
        readGranted: null,
        backgroundGranted: null,
        manufacturerPackage: null,
        lastSyncAt: null,
        lastFailure: { reason: 'OTHER', at: new Date('2026-10-22T13:15:00.000Z') },
      },
      bluetooth: {
        bandChosen: null,
        listenerState: null,
        listenerStateSince: null,
        lastReadingAt: new Date('2026-10-22T13:01:00.000Z'),
      },
    })
  })

  it('aparelho sem relato não tem relato', () => {
    const columns = readinessColumnsOf({ healthConnect: {}, bluetooth: {} }, AGORA)
    expect(readinessReportOf({ ...columns, readinessReportedAt: null })).toBeNull()
  })

  it('falha sem hora gravada não vira falha pela metade', () => {
    const columns = readinessColumnsOf({ healthConnect: {}, bluetooth: {} }, AGORA)
    const semHora = { ...columns, healthConnectFailureReason: 'OTHER' as const }
    expect(readinessReportOf(semHora)?.healthConnect.lastFailure).toBeNull()
  })
})
