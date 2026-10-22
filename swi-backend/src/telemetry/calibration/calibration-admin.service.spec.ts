import { BadRequestException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import type { PrismaService } from '../../prisma/prisma.service'
import { CALIBRATION_HISTORY_PAGE, CalibrationAdminService } from './calibration-admin.service'

// Prisma é dublê: o que se protege aqui é o escopo (404 sem vazar), o que se
// grava e o histórico na mesma transação. Contra banco real fica no e2e.

const ADMIN = { userId: 'admin-1', role: 'ADMIN', companyId: 'company-1' }
const NOW = new Date('2026-10-21T12:00:00.000Z')
const WORKER = { companyId: 'company-1', role: 'WORKER' }

const prismaDouble = () => {
  const prisma: any = {
    user: { findUnique: jest.fn().mockResolvedValue(WORKER), findMany: jest.fn().mockResolvedValue([]) },
    profile: { findUnique: jest.fn().mockResolvedValue(null) },
    workerCalibration: { findUnique: jest.fn().mockResolvedValue(null) },
    workerCalibrationBand: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      update: jest.fn(),
    },
    workerSafetyLimit: {
      findMany: jest.fn().mockResolvedValue([]),
      findUnique: jest.fn().mockResolvedValue(null),
      upsert: jest.fn(),
      delete: jest.fn(),
    },
    workerCalibrationChange: { create: jest.fn(), findMany: jest.fn().mockResolvedValue([]) },
  }
  prisma.$transaction = jest.fn((fn: (tx: unknown) => unknown) => fn(prisma))
  return prisma
}

const service = (prisma: any) => new CalibrationAdminService(prisma as PrismaService)

describe('CalibrationAdminService: escopo', () => {
  it.each([
    ['inexistente', null, ADMIN],
    ['de outra empresa', { companyId: 'company-2', role: 'WORKER' }, ADMIN],
    ['que não é funcionário', { companyId: 'company-1', role: 'ADMIN' }, ADMIN],
    ['com quem chama sem empresa', WORKER, { ...ADMIN, companyId: null }],
  ])('funcionário %s responde o mesmo 404', async (_n, user, caller) => {
    const prisma = prismaDouble()
    prisma.user.findUnique.mockResolvedValue(user)
    await expect(service(prisma).detail(caller as any, 'w1', NOW)).rejects.toThrow(
      new NotFoundException('Funcionário não encontrado'),
    )
    await expect(service(prisma).setBand(caller as any, 'w1', 'HEART_RATE', { excellence: 1, fatigue: 2 })).rejects.toThrow(
      NotFoundException,
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })
})

describe('CalibrationAdminService.detail', () => {
  it('sem calibração: primeiro dia, as 11 medições na partida mínima e as 5 travas no padrão', async () => {
    const prisma = prismaDouble()
    prisma.profile.findUnique.mockResolvedValue({ birthDate: new Date('1986-10-21T00:00:00.000Z') })
    const d = await service(prisma).detail(ADMIN, 'w1', NOW)
    expect(d).toMatchObject({ phase: 'CALIBRATING', day: 1, version: null, recalibrating: false, deviceFamily: null })
    expect(d.ruler.maxBpmByAge).toEqual(expect.any(Number))
    expect(d.metrics).toHaveLength(11)
    const hr = d.metrics.find((m) => m.metric === 'HEART_RATE')!
    expect(hr).toMatchObject({ source: 'START', validDays: 0, override: null })
    expect(hr.effective.fatigue).toBeCloseTo(0.9 * d.ruler.maxBpmByAge!)
    expect(d.safety.map((s) => s.rule)).toEqual(['HEART_RATE_HIGH', 'HEART_RATE_LOW', 'OXYGEN_LOW', 'BLOOD_PRESSURE_HIGH', 'WEAR_HIGH'])
    expect(d.safety.every((s) => !s.custom && s.updatedAt === null && s.effective === s.defaultValues)).toBe(true)
  })

  it('calibrada: aprendido, correção do gestor, linha torta e trava personalizada', async () => {
    const prisma = prismaDouble()
    const at = new Date('2026-10-20T10:00:00.000Z')
    prisma.workerCalibration.findUnique.mockResolvedValue({
      version: 'swi-calibration-1',
      validDays: 30,
      recalibrating: false,
      deviceFamily: 'APPLE_WATCH',
      restingBpm: 60,
      peakBpm: 170,
      peakPersonalBpm: 168,
      peakStartBpm: 171,
    })
    prisma.workerCalibrationBand.findMany.mockResolvedValue([
      { metric: 'HEART_RATE', validDays: 30, startCuts: { excellence: null, fatigue: 160 }, learnedCuts: { excellence: 65, fatigue: 150 }, overrideCuts: null },
      { metric: 'WEAR', validDays: 30, startCuts: { excellence: null, fatigue: 80 }, learnedCuts: { excellence: 20, fatigue: 70 }, overrideCuts: { excellence: 25, fatigue: 75 } },
      { metric: 'STEPS', validDays: 4, startCuts: 'torto', learnedCuts: { below: 1 }, overrideCuts: { below: 'x' } },
    ])
    prisma.workerSafetyLimit.findMany.mockResolvedValue([
      { rule: 'OXYGEN_LOW', values: { openAt: 88, closeAt: 92 }, updatedAt: at },
      { rule: 'WEAR_HIGH', values: { openAt: 'torto' }, updatedAt: at },
    ])
    const d = await service(prisma).detail(ADMIN, 'w1', NOW)
    expect(d).toMatchObject({ phase: 'CALIBRATED', day: null, ruler: { restingBpm: 60, maxBpmByAge: null } })
    const by = (m: string) => d.metrics.find((x) => x.metric === m)!
    expect(by('HEART_RATE')).toMatchObject({ source: 'LEARNED', effective: { excellence: 65, fatigue: 150 } })
    expect(by('WEAR')).toMatchObject({ source: 'OVERRIDE', effective: { excellence: 25, fatigue: 75 } })
    expect(by('STEPS')).toMatchObject({ source: 'LEARNED', override: null, learned: { below: null, above: null } })
    const oxygen = d.safety.find((s) => s.rule === 'OXYGEN_LOW')!
    expect(oxygen).toMatchObject({ custom: true, effective: { openAt: 88, closeAt: 92 }, updatedAt: at })
    expect(d.safety.find((s) => s.rule === 'WEAR_HIGH')).toMatchObject({ custom: false, updatedAt: null })
    expect(d.safety.find((s) => s.rule === 'HEART_RATE_LOW')!.defaultValues).toEqual({ openAt: 45, closeAt: 55 })
  })

  // O recálculo grava linha para toda medição, mesmo sem dia válido, e antes
  // do PERSONAL_FROM_DAY o aprendido é a própria partida. Chamar isso de
  // "Aprendida" no painel diria que o sistema já conhece a pessoa.
  it('linha gravada antes do 3º dia válido segue na partida', async () => {
    const prisma = prismaDouble()
    const start = { excellence: 95, fatigue: 92 }
    prisma.workerCalibrationBand.findMany.mockResolvedValue([
      { metric: 'HEART_RATE', validDays: 0, startCuts: { excellence: 108, fatigue: 162 }, learnedCuts: { excellence: 108, fatigue: 162 }, overrideCuts: null },
      { metric: 'OXYGEN_SATURATION', validDays: 2, startCuts: start, learnedCuts: start, overrideCuts: null },
      { metric: 'EFFORT', validDays: 3, startCuts: { excellence: 40, fatigue: 80 }, learnedCuts: { excellence: 38, fatigue: 79 }, overrideCuts: null },
      { metric: 'WEAR', validDays: 0, startCuts: { excellence: 40, fatigue: 80 }, learnedCuts: { excellence: 40, fatigue: 80 }, overrideCuts: { excellence: 30, fatigue: 70 } },
    ])
    const d = await service(prisma).detail(ADMIN, 'w1', NOW)
    const by = (m: string) => d.metrics.find((x) => x.metric === m)!
    expect(by('HEART_RATE')).toMatchObject({ source: 'START', validDays: 0 })
    expect(by('OXYGEN_SATURATION')).toMatchObject({ source: 'START', validDays: 2 })
    expect(by('EFFORT')).toMatchObject({ source: 'LEARNED', validDays: 3 })
    expect(by('WEAR')).toMatchObject({ source: 'OVERRIDE' })
  })
})

describe('CalibrationAdminService: faixas', () => {
  it('corte invertido responde 400 sem abrir transação', async () => {
    const prisma = prismaDouble()
    await expect(service(prisma).setBand(ADMIN, 'w1', 'HEART_RATE', { excellence: 150, fatigue: 70 })).rejects.toThrow(
      BadRequestException,
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('sem linha ainda: cria da partida mínima com a correção e grava o histórico sem valor anterior', async () => {
    const prisma = prismaDouble()
    await service(prisma).setBand(ADMIN, 'w1', 'SYSTOLIC', { excellence: 110, fatigue: 135, extra: 1 }, NOW)
    expect(prisma.workerCalibrationBand.create).toHaveBeenCalledWith({
      data: {
        workerId: 'w1',
        metric: 'SYSTOLIC',
        validDays: 0,
        startCuts: { excellence: 120, fatigue: 140 },
        learnedCuts: { excellence: 120, fatigue: 140 },
        computedAt: NOW,
        overrideCuts: { excellence: 110, fatigue: 135 },
        overrideById: 'admin-1',
        overrideAt: NOW,
      },
    })
    expect(prisma.workerCalibrationChange.create).toHaveBeenCalledWith({
      data: {
        workerId: 'w1',
        action: 'BAND_OVERRIDE',
        metric: 'SYSTOLIC',
        actorId: 'admin-1',
        from: Prisma.DbNull,
        to: { excellence: 110, fatigue: 135 },
      },
    })
  })

  it('com linha: só a correção muda, e o histórico leva a correção anterior', async () => {
    const prisma = prismaDouble()
    prisma.workerCalibrationBand.findUnique.mockResolvedValue({ overrideCuts: { excellence: 100, fatigue: 130 } })
    await service(prisma).setBand(ADMIN, 'w1', 'SYSTOLIC', { excellence: 110, fatigue: 135 }, NOW)
    expect(prisma.workerCalibrationBand.create).not.toHaveBeenCalled()
    expect(prisma.workerCalibrationBand.update).toHaveBeenCalledWith({
      where: { workerId_metric: { workerId: 'w1', metric: 'SYSTOLIC' } },
      data: { overrideCuts: { excellence: 110, fatigue: 135 }, overrideById: 'admin-1', overrideAt: NOW },
    })
    expect(prisma.workerCalibrationChange.create.mock.calls[0][0].data.from).toEqual({ excellence: 100, fatigue: 130 })
  })

  it('remover a correção volta ao aprendido e grava BAND_REVERT; sem correção não grava nada', async () => {
    const prisma = prismaDouble()
    prisma.workerCalibrationBand.findUnique.mockResolvedValueOnce({ overrideCuts: { excellence: 100, fatigue: 130 } })
    await service(prisma).clearBand(ADMIN, 'w1', 'SYSTOLIC', NOW)
    expect(prisma.workerCalibrationBand.update).toHaveBeenCalledWith({
      where: { workerId_metric: { workerId: 'w1', metric: 'SYSTOLIC' } },
      data: { overrideCuts: Prisma.DbNull, overrideById: null, overrideAt: null },
    })
    expect(prisma.workerCalibrationChange.create.mock.calls[0][0].data).toMatchObject({
      action: 'BAND_REVERT',
      from: { excellence: 100, fatigue: 130 },
      to: Prisma.DbNull,
    })

    prisma.workerCalibrationBand.findUnique.mockResolvedValueOnce({ overrideCuts: null })
    prisma.workerCalibrationBand.findUnique.mockResolvedValueOnce(null)
    await service(prisma).clearBand(ADMIN, 'w1', 'SYSTOLIC', NOW)
    await service(prisma).clearBand(ADMIN, 'w1', 'SYSTOLIC', NOW)
    expect(prisma.workerCalibrationBand.update).toHaveBeenCalledTimes(1)
    expect(prisma.workerCalibrationChange.create).toHaveBeenCalledTimes(1)
  })
})

describe('CalibrationAdminService: travas', () => {
  it('valor fora do plausível responde 400', async () => {
    const prisma = prismaDouble()
    await expect(service(prisma).setSafety(ADMIN, 'w1', 'OXYGEN_LOW', { openAt: 50, closeAt: 60 })).rejects.toThrow(
      BadRequestException,
    )
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('gravar faz upsert com quem gravou e o histórico leva o anterior', async () => {
    const prisma = prismaDouble()
    prisma.workerSafetyLimit.findUnique.mockResolvedValue({ values: { openAt: 89, closeAt: 93 } })
    await service(prisma).setSafety(ADMIN, 'w1', 'OXYGEN_LOW', { openAt: 88, closeAt: 92 }, NOW)
    const data = { values: { openAt: 88, closeAt: 92 }, updatedById: 'admin-1' }
    expect(prisma.workerSafetyLimit.upsert).toHaveBeenCalledWith({
      where: { workerId_rule: { workerId: 'w1', rule: 'OXYGEN_LOW' } },
      create: { workerId: 'w1', rule: 'OXYGEN_LOW', ...data },
      update: data,
    })
    expect(prisma.workerCalibrationChange.create.mock.calls[0][0].data).toMatchObject({
      action: 'SAFETY_SET',
      rule: 'OXYGEN_LOW',
      from: { openAt: 89, closeAt: 93 },
      to: { openAt: 88, closeAt: 92 },
    })
  })

  it('remover apaga a linha e grava SAFETY_REVERT; sem linha não grava nada', async () => {
    const prisma = prismaDouble()
    prisma.workerSafetyLimit.findUnique.mockResolvedValueOnce({ values: { openAt: 88, closeAt: 92 } })
    await service(prisma).clearSafety(ADMIN, 'w1', 'OXYGEN_LOW', NOW)
    expect(prisma.workerSafetyLimit.delete).toHaveBeenCalledWith({ where: { workerId_rule: { workerId: 'w1', rule: 'OXYGEN_LOW' } } })
    expect(prisma.workerCalibrationChange.create.mock.calls[0][0].data).toMatchObject({ action: 'SAFETY_REVERT', to: Prisma.DbNull })

    await service(prisma).clearSafety(ADMIN, 'w1', 'OXYGEN_LOW', NOW)
    expect(prisma.workerSafetyLimit.delete).toHaveBeenCalledTimes(1)
    expect(prisma.workerCalibrationChange.create).toHaveBeenCalledTimes(1)
  })
})

describe('CalibrationAdminService.history', () => {
  const change = (i: number, actorId: string | null) => ({
    id: `c${i}`,
    action: 'BAND_OVERRIDE',
    metric: 'HEART_RATE',
    rule: null,
    from: null,
    to: { excellence: 1, fatigue: 2 },
    actorId,
    at: new Date(NOW.getTime() - i * 1000),
  })

  it('pagina de 50 com cursor, nome de quem fez, e o job sem ator', async () => {
    const prisma = prismaDouble()
    const rows = Array.from({ length: CALIBRATION_HISTORY_PAGE + 1 }, (_, i) => change(i, i === 0 ? null : 'admin-1'))
    prisma.workerCalibrationChange.findMany.mockResolvedValue(rows)
    prisma.user.findMany.mockResolvedValue([{ id: 'admin-1', name: 'Ana' }])
    const page = await service(prisma).history(ADMIN, 'w1', 'c-anterior')
    expect(prisma.workerCalibrationChange.findMany).toHaveBeenCalledWith({
      where: { workerId: 'w1' },
      orderBy: [{ at: 'desc' }, { id: 'desc' }],
      take: CALIBRATION_HISTORY_PAGE + 1,
      cursor: { id: 'c-anterior' },
      skip: 1,
    })
    expect(page.items).toHaveLength(CALIBRATION_HISTORY_PAGE)
    expect(page.items[0].actor).toBeNull()
    expect(page.items[1].actor).toEqual({ id: 'admin-1', name: 'Ana' })
    expect(page.nextCursor).toBe(`c${CALIBRATION_HISTORY_PAGE - 1}`)
  })

  it('última página sem próxima; ator apagado fica sem nome; sem ator não consulta usuários', async () => {
    const prisma = prismaDouble()
    prisma.workerCalibrationChange.findMany.mockResolvedValueOnce([change(0, 'sumiu')])
    const page = await service(prisma).history(ADMIN, 'w1')
    expect(page).toMatchObject({ nextCursor: null, items: [{ actor: { id: 'sumiu', name: '' } }] })

    prisma.workerCalibrationChange.findMany.mockResolvedValueOnce([change(0, null)])
    prisma.user.findMany.mockClear()
    await service(prisma).history(ADMIN, 'w1')
    expect(prisma.user.findMany).not.toHaveBeenCalled()
  })
})
