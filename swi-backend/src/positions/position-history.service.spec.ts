import { BadRequestException } from '@nestjs/common'
import { cellCenter, cellOf, HEAT_CELL_SIZE_M } from './position-history'
import {
  HEAT_DEFAULT_WINDOW_MS,
  HEAT_MAX_WINDOW_MS,
  PositionHistoryService,
} from './position-history.service'

const NOW = new Date('2026-10-01T12:00:00.000Z')
const DAY = 24 * 60 * 60 * 1000

const prisma = () =>
  ({
    workerPositionSample: { findFirst: jest.fn(), create: jest.fn() },
    $queryRaw: jest.fn(),
    $executeRaw: jest.fn(),
  }) as any

const worker = { id: 'w1', companyId: 'org1' }

describe('PositionHistoryService.record: só movimento vira amostra', () => {
  it('primeira posição grava com a empresa e a origem', async () => {
    const db = prisma()
    db.workerPositionSample.findFirst.mockResolvedValue(null)
    await new PositionHistoryService(db).record(worker, -23.55, -46.63, 'real', NOW)
    expect(db.workerPositionSample.findFirst).toHaveBeenCalledWith({
      where: { workerId: 'w1' },
      orderBy: { recordedAt: 'desc' },
      select: { lat: true, lng: true, recordedAt: true },
    })
    expect(db.workerPositionSample.create).toHaveBeenCalledWith({
      data: { workerId: 'w1', companyId: 'org1', lat: -23.55, lng: -46.63, source: 'real', recordedAt: NOW },
    })
  })

  it('parado há poucos segundos não grava', async () => {
    const db = prisma()
    db.workerPositionSample.findFirst.mockResolvedValue({
      lat: -23.55,
      lng: -46.63,
      recordedAt: new Date(NOW.getTime() - 10_000),
    })
    await new PositionHistoryService(db).record(worker, -23.55, -46.63, 'real', NOW)
    expect(db.workerPositionSample.create).not.toHaveBeenCalled()
  })

  it('posição do simulador grava como sim', async () => {
    const db = prisma()
    db.workerPositionSample.findFirst.mockResolvedValue(null)
    await new PositionHistoryService(db).record(worker, -23.55, -46.63, 'sim', NOW)
    expect(db.workerPositionSample.create.mock.calls[0][0].data.source).toBe('sim')
  })
})

describe('PositionHistoryService.heat', () => {
  it('sem janela usa as últimas 24 horas e devolve centros de célula', async () => {
    const db = prisma()
    const { row, col } = cellOf({ lat: -23.55, lng: -46.63 })
    db.$queryRaw.mockResolvedValue([{ row: BigInt(row), col: BigInt(col), weight: BigInt(7) }])
    const out = await new PositionHistoryService(db).heat('org1', {}, { includeSim: false }, NOW)
    expect(out.cellSizeM).toBe(HEAT_CELL_SIZE_M)
    expect(out.from).toBe(new Date(NOW.getTime() - HEAT_DEFAULT_WINDOW_MS).toISOString())
    expect(out.to).toBe(NOW.toISOString())
    expect(out.cells).toEqual([{ ...cellCenter(row, col), weight: 7 }])
    expect(HEAT_DEFAULT_WINDOW_MS).toBe(DAY)
  })

  it('a consulta leva a empresa, a janela e só a origem real', async () => {
    const db = prisma()
    db.$queryRaw.mockResolvedValue([])
    await new PositionHistoryService(db).heat('org1', {}, { includeSim: false }, NOW)
    const sql = db.$queryRaw.mock.calls[0][0]
    expect(sql.values).toEqual(expect.arrayContaining(['org1', ['real']]))
  })

  it('com a homologação ligada, inclui as posições do simulador', async () => {
    const db = prisma()
    db.$queryRaw.mockResolvedValue([])
    await new PositionHistoryService(db).heat('org1', {}, { includeSim: true }, NOW)
    expect(db.$queryRaw.mock.calls[0][0].values).toEqual(expect.arrayContaining([['real', 'sim']]))
  })

  it('admin sem empresa consulta o balde sem empresa, como a lista de posições', async () => {
    const db = prisma()
    db.$queryRaw.mockResolvedValue([])
    await new PositionHistoryService(db).heat(null, {}, { includeSim: false }, NOW)
    expect(db.$queryRaw.mock.calls[0][0].sql).toContain('"companyId" IS NULL')
  })

  // O balde sem empresa é do administrador legado; funcionário sem empresa não
  // tem obra, e não pode ler a presença de quem também está sem empresa.
  it('funcionário sem empresa recebe o mapa vazio, sem consultar o banco', async () => {
    const db = prisma()
    const out = await new PositionHistoryService(db).heat(null, {}, { includeSim: false, noCompany: 'empty' }, NOW)
    expect(out).toEqual({
      cellSizeM: HEAT_CELL_SIZE_M,
      from: new Date(NOW.getTime() - HEAT_DEFAULT_WINDOW_MS).toISOString(),
      to: NOW.toISOString(),
      cells: [],
    })
    expect(db.$queryRaw).not.toHaveBeenCalled()
  })

  it('funcionário com empresa lê a empresa dele', async () => {
    const db = prisma()
    db.$queryRaw.mockResolvedValue([])
    await new PositionHistoryService(db).heat('org1', {}, { includeSim: false, noCompany: 'empty' }, NOW)
    expect(db.$queryRaw).toHaveBeenCalledTimes(1)
  })

  it('células mais quentes primeiro', async () => {
    const db = prisma()
    db.$queryRaw.mockResolvedValue([
      { row: BigInt(1), col: BigInt(1), weight: BigInt(2) },
      { row: BigInt(2), col: BigInt(2), weight: BigInt(9) },
    ])
    const out = await new PositionHistoryService(db).heat('org1', {}, { includeSim: false }, NOW)
    expect(out.cells.map((c) => c.weight)).toEqual([9, 2])
  })

  it('recusa janela invertida e janela acima do teto', async () => {
    const svc = new PositionHistoryService(prisma())
    await expect(
      svc.heat('org1', { from: NOW.toISOString(), to: new Date(NOW.getTime() - 1).toISOString() }, { includeSim: false }, NOW),
    ).rejects.toBeInstanceOf(BadRequestException)
    await expect(
      svc.heat(
        'org1',
        { from: new Date(NOW.getTime() - HEAT_MAX_WINDOW_MS - 1).toISOString(), to: NOW.toISOString() },
        { includeSim: false },
        NOW,
      ),
    ).rejects.toBeInstanceOf(BadRequestException)
    expect(HEAT_MAX_WINDOW_MS).toBe(30 * DAY)
  })
})

describe('PositionHistoryService.purge: apaga o que passou da janela, em lotes', () => {
  it('repete lotes enquanto vierem cheios e para no primeiro lote curto', async () => {
    const db = prisma()
    db.$executeRaw.mockResolvedValueOnce(5_000).mockResolvedValueOnce(5_000).mockResolvedValueOnce(12)
    const out = await new PositionHistoryService(db).purge(NOW, { windowMs: 30 * DAY, batchSize: 5_000 })
    expect(out).toEqual({ deleted: 10_012, stoppedByBudget: false })
    expect(db.$executeRaw).toHaveBeenCalledTimes(3)
    const sql = db.$executeRaw.mock.calls[0][0]
    expect(sql.values).toEqual([new Date(NOW.getTime() - 30 * DAY), 5_000])
  })

  it('para no orçamento de tempo e deixa o resto para a próxima rodada', async () => {
    const db = prisma()
    db.$executeRaw.mockResolvedValue(10)
    let clock = 0
    const svc = new PositionHistoryService(db, () => (clock += 40_000))
    const out = await svc.purge(NOW, { windowMs: 30 * DAY, batchSize: 10 })
    expect(out.stoppedByBudget).toBe(true)
    expect(db.$executeRaw.mock.calls.length).toBeLessThan(3)
  })
})
