import { WeatherAlertService, NO_COMPANY_SCOPE } from './weather-alert.service'
import { SITE_LOCATION } from './weather.types'
import type { WeatherAlert } from './weather.types'

const NOW = new Date('2026-03-10T12:30:00.000Z')

const alert = (over: Partial<WeatherAlert> = {}): WeatherAlert => ({
  id: 'wx:CHUVA_INTENSA:2026-03-10T13:00:00.000Z',
  kind: 'CHUVA_INTENSA',
  severity: 'ATENCAO',
  event: 'Chuva intensa',
  description: 'Chuva forte prevista entre 10:00 e 13:00, com até 22 mm por hora.',
  startsAt: '2026-03-10T13:00:00.000Z',
  endsAt: '2026-03-10T16:00:00.000Z',
  ...over,
})

const DEMO = alert({ id: 'wx-0', kind: 'TEMPESTADE', severity: 'PERIGO', event: 'Tempestade severa', description: 'demo' })

interface Setup {
  workers?: Array<{ id: string; companyId: string | null }>
  companies?: Array<{ id: string; lat: number | null; lng: number | null }>
  alertsByLat?: Record<string, WeatherAlert[]>
  demo?: WeatherAlert[]
  seenById?: string[]
  seenWindow?: { alertId: string; endsAt: Date; severity?: string | null } | null
  createRejects?: boolean
}

function mk(s: Setup = {}) {
  const enqueueForMany = jest.fn().mockResolvedValue(undefined)
  const prisma = {
    user: { findMany: jest.fn().mockResolvedValue(s.workers ?? [{ id: 'u1', companyId: 'c1' }, { id: 'u2', companyId: 'c1' }]) },
    company: { findMany: jest.fn().mockResolvedValue(s.companies ?? [{ id: 'c1', lat: -3.1, lng: -60.02 }]) },
    weatherAlertSeen: {
      findUnique: jest.fn(async ({ where }: { where: { alertId: string } }) =>
        (s.seenById ?? []).includes(where.alertId) ? { alertId: where.alertId } : null),
      findFirst: jest.fn().mockResolvedValue(s.seenWindow ?? null),
      create: s.createRejects ? jest.fn().mockRejectedValue(new Error('db down')) : jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
    },
  }
  const weather = {
    alertsAt: jest.fn(async (loc: { lat: number }) => (s.alertsByLat ?? { '-3.1': [alert()] })[String(loc.lat)] ?? []),
    demoAlerts: jest.fn(() => s.demo ?? []),
  }
  const svc = new WeatherAlertService(weather as never, prisma as never, { enqueueForMany } as never)
  return { svc, enqueueForMany, prisma, weather }
}

describe('WeatherAlertService.pollAndNotify', () => {
  it('destinatários são os funcionários aprovados e ativos', async () => {
    const { svc, prisma } = mk()
    await svc.pollAndNotify(NOW)
    expect(prisma.user.findMany).toHaveBeenCalledWith({
      where: { role: 'WORKER', approvalStatus: 'APPROVED', active: true },
      select: { id: true, companyId: true },
    })
  })

  it('alerta novo avisa só os funcionários da empresa, no local dela, e grava o aviso', async () => {
    const { svc, enqueueForMany, prisma, weather } = mk({
      workers: [{ id: 'u1', companyId: 'c1' }, { id: 'u2', companyId: 'c2' }],
      companies: [{ id: 'c1', lat: -3.1, lng: -60.02 }, { id: 'c2', lat: -8, lng: -35 }],
      alertsByLat: { '-3.1': [alert()] },
    })
    await svc.pollAndNotify(NOW)
    expect(weather.alertsAt).toHaveBeenCalledWith({ lat: -3.1, lng: -60.02 }, NOW)
    expect(weather.alertsAt).toHaveBeenCalledWith({ lat: -8, lng: -35 }, NOW)
    expect(enqueueForMany).toHaveBeenCalledTimes(1)
    expect(enqueueForMany).toHaveBeenCalledWith(['u1'], {
      domain: 'weather',
      title: 'Alerta Meteorológico: Chuva intensa',
      body: alert().description,
      targetId: alert().id,
    })
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({
      data: {
        alertId: `c1:${alert().id}`,
        scope: 'c1',
        kind: 'CHUVA_INTENSA',
        endsAt: new Date(alert().endsAt),
        severity: 'ATENCAO',
      },
    })
  })

  it('funcionário sem empresa fica no local padrão, num balde próprio', async () => {
    const { svc, enqueueForMany, prisma, weather } = mk({
      workers: [{ id: 'u9', companyId: null }],
      companies: [],
      alertsByLat: { [String(SITE_LOCATION.lat)]: [alert()] },
    })
    await svc.pollAndNotify(NOW)
    expect(prisma.company.findMany).not.toHaveBeenCalled()
    expect(weather.alertsAt).toHaveBeenCalledWith(SITE_LOCATION, NOW)
    expect(enqueueForMany).toHaveBeenCalledWith(['u9'], expect.objectContaining({ targetId: alert().id }))
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ scope: NO_COMPANY_SCOPE, alertId: `${NO_COMPANY_SCOPE}:${alert().id}` }),
    })
  })

  it('alerta que encosta numa janela já avisada é o mesmo: não avisa, só estende a janela', async () => {
    const { svc, enqueueForMany, prisma } = mk({
      seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T14:00:00.000Z') },
    })
    await svc.pollAndNotify(NOW)
    expect(prisma.weatherAlertSeen.findFirst).toHaveBeenCalledWith({
      where: { scope: 'c1', kind: 'CHUVA_INTENSA', endsAt: { gte: new Date(alert().startsAt) } },
      orderBy: { endsAt: 'desc' },
    })
    expect(enqueueForMany).not.toHaveBeenCalled()
    expect(prisma.weatherAlertSeen.update).toHaveBeenCalledWith({
      where: { alertId: 'c1:antigo' },
      data: { endsAt: new Date(alert().endsAt) },
    })
  })

  it('janela avisada que já cobre o alerta não é reescrita', async () => {
    const { svc, prisma } = mk({
      seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T18:00:00.000Z') },
    })
    await svc.pollAndNotify(NOW)
    expect(prisma.weatherAlertSeen.update).not.toHaveBeenCalled()
  })

  describe('agravamento para perigo', () => {
    const PERIGO = alert({ severity: 'PERIGO', description: 'Chuva forte prevista entre 10:00 e 13:00, com até 34 mm por hora.' })

    it('alerta avisado como atenção que sobe para perigo avisa de novo e grava a gravidade', async () => {
      const { svc, enqueueForMany, prisma } = mk({
        alertsByLat: { '-3.1': [PERIGO] },
        seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T14:00:00.000Z'), severity: 'ATENCAO' },
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).toHaveBeenCalledTimes(1)
      expect(enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], {
        domain: 'weather',
        title: 'Alerta Meteorológico agravado: Chuva intensa',
        body: PERIGO.description,
        targetId: PERIGO.id,
      })
      expect(prisma.weatherAlertSeen.update).toHaveBeenCalledWith({
        where: { alertId: 'c1:antigo' },
        data: { endsAt: new Date(PERIGO.endsAt), severity: 'PERIGO' },
      })
    })

    it('registro anterior à gravidade (nulo) conta como atenção', async () => {
      const { svc, enqueueForMany } = mk({
        alertsByLat: { '-3.1': [PERIGO] },
        seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T18:00:00.000Z'), severity: null },
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).toHaveBeenCalledTimes(1)
    })

    it('alerta já avisado como perigo não avisa de novo', async () => {
      const { svc, enqueueForMany, prisma } = mk({
        alertsByLat: { '-3.1': [PERIGO] },
        seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T18:00:00.000Z'), severity: 'PERIGO' },
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).not.toHaveBeenCalled()
      expect(prisma.weatherAlertSeen.update).not.toHaveBeenCalled()
    })

    it('alerta que desce de perigo para atenção não avisa, mas rebaixa o registro para a volta a perigo avisar', async () => {
      const { svc, enqueueForMany, prisma } = mk({
        seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T18:00:00.000Z'), severity: 'PERIGO' },
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).not.toHaveBeenCalled()
      expect(prisma.weatherAlertSeen.update).toHaveBeenCalledWith({
        where: { alertId: 'c1:antigo' },
        data: { severity: 'ATENCAO' },
      })
    })
  })

  describe('sol intenso', () => {
    const sun = (severity: WeatherAlert['severity']) =>
      alert({ id: 'wx:SOL_INTENSO:2026-03-10T13:00:00.000Z', kind: 'SOL_INTENSO', event: 'Sol intenso', severity })

    it('em atenção não avisa nem grava: fica só na tela', async () => {
      const { svc, enqueueForMany, prisma } = mk({ alertsByLat: { '-3.1': [sun('ATENCAO')] } })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).not.toHaveBeenCalled()
      expect(prisma.weatherAlertSeen.create).not.toHaveBeenCalled()
    })

    it('em atenção com registro de perigo anterior não avisa: estende a janela e rebaixa o registro', async () => {
      const { svc, enqueueForMany, prisma } = mk({
        alertsByLat: { '-3.1': [sun('ATENCAO')] },
        seenWindow: { alertId: 'c1:antigo', endsAt: new Date('2026-03-10T14:00:00.000Z'), severity: 'PERIGO' },
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).not.toHaveBeenCalled()
      expect(prisma.weatherAlertSeen.update).toHaveBeenCalledWith({
        where: { alertId: 'c1:antigo' },
        data: { endsAt: new Date(alert().endsAt), severity: 'ATENCAO' },
      })
    })

    it('em perigo avisa uma vez, como alerta novo', async () => {
      const { svc, enqueueForMany, prisma } = mk({ alertsByLat: { '-3.1': [sun('PERIGO')] } })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).toHaveBeenCalledTimes(1)
      expect(enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ title: 'Alerta Meteorológico: Sol intenso' }))
      expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({
        data: expect.objectContaining({ kind: 'SOL_INTENSO', severity: 'PERIGO' }),
      })
    })
  })

  it('empresa sem funcionário aprovado não consulta o clima', async () => {
    const { svc, weather } = mk({ workers: [] })
    await svc.pollAndNotify(NOW)
    expect(weather.alertsAt).not.toHaveBeenCalled()
  })

  it('falha numa empresa não impede o aviso das outras', async () => {
    const { svc, enqueueForMany, weather } = mk({
      workers: [{ id: 'u1', companyId: 'c1' }, { id: 'u2', companyId: 'c2' }],
      companies: [{ id: 'c1', lat: -3.1, lng: -60.02 }, { id: 'c2', lat: -8, lng: -35 }],
      alertsByLat: { '-8': [alert()] },
    })
    weather.alertsAt.mockRejectedValueOnce(new Error('boom'))
    await expect(svc.pollAndNotify(NOW)).resolves.toBeUndefined()
    expect(enqueueForMany).toHaveBeenCalledWith(['u2'], expect.anything())
  })

  it('erro ao listar destinatários → swallow (best-effort, não relança)', async () => {
    const { svc, prisma } = mk()
    prisma.user.findMany.mockRejectedValueOnce(new Error('db down'))
    await expect(svc.pollAndNotify(NOW)).resolves.toBeUndefined()
  })

  it('falha ao gravar o aviso (após notificar) → swallow (best-effort, não relança)', async () => {
    const { svc, enqueueForMany, prisma } = mk({ createRejects: true })
    await expect(svc.pollAndNotify(NOW)).resolves.toBeUndefined()
    expect(enqueueForMany).toHaveBeenCalled()
    expect(prisma.weatherAlertSeen.create).toHaveBeenCalled()
  })

  describe('alerta de demonstração', () => {
    it('novo → avisa todos os aprovados de uma vez e grava pelo id fixo', async () => {
      const { svc, enqueueForMany, prisma } = mk({
        workers: [{ id: 'u1', companyId: 'c1' }, { id: 'u2', companyId: null }],
        alertsByLat: {},
        demo: [DEMO],
      })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).toHaveBeenCalledWith(['u1', 'u2'], expect.objectContaining({ targetId: 'wx-0', body: 'demo' }))
      expect(prisma.weatherAlertSeen.create).toHaveBeenCalledWith({ data: { alertId: 'wx-0' } })
    })

    it('já visto (o seed pré-marca) → não avisa de novo', async () => {
      const { svc, enqueueForMany } = mk({ alertsByLat: {}, demo: [DEMO], seenById: ['wx-0'] })
      await svc.pollAndNotify(NOW)
      expect(enqueueForMany).not.toHaveBeenCalled()
    })
  })
})
