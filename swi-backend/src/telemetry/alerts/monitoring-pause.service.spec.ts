import { NotFoundException } from '@nestjs/common'
import type { JwtUser } from '../../auth/current-user.decorator'
import type { PrismaService } from '../../prisma/prisma.service'
import { MonitoringPauseService } from './monitoring-pause.service'

const NOW = new Date('2026-10-22T12:00:00.000Z')
const caller: JwtUser = { userId: 'admin-1', role: 'ADMIN', companyId: 'org1' }

const prismaDouble = (target: { companyId: string | null; role: string } | null, pausedAt: Date | null) => {
  const db: any = {
    user: {
      findUnique: jest.fn().mockImplementation(async ({ select }: any) =>
        select.monitoringPausedAt ? { monitoringPausedAt: pausedAt } : target,
      ),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }
  return db
}
const service = (db: any) => new MonitoringPauseService(db as PrismaService)

describe('MonitoringPauseService', () => {
  it('pausar grava o instante só em quem não está pausado e devolve o estado', async () => {
    const db = prismaDouble({ companyId: 'org1', role: 'WORKER' }, NOW)

    const state = await service(db).pause(caller, 'w1', NOW)

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', monitoringPausedAt: null },
      data: { monitoringPausedAt: NOW },
    })
    expect(state).toEqual({ workerId: 'w1', monitoringPausedAt: NOW.toISOString() })
  })

  it('retomar limpa a pausa e devolve nulo', async () => {
    const db = prismaDouble({ companyId: 'org1', role: 'WORKER' }, null)

    const state = await service(db).resume(caller, 'w1')

    expect(db.user.updateMany).toHaveBeenCalledWith({
      where: { id: 'w1', monitoringPausedAt: { not: null } },
      data: { monitoringPausedAt: null },
    })
    expect(state).toEqual({ workerId: 'w1', monitoringPausedAt: null })
  })

  it.each([
    ['inexistente', null],
    ['de outra empresa', { companyId: 'org2', role: 'WORKER' }],
    ['que não é funcionário', { companyId: 'org1', role: 'ADMIN' }],
  ])('alvo %s responde 404 e nada é gravado', async (_, target) => {
    const db = prismaDouble(target, null)

    await expect(service(db).pause(caller, 'w1', NOW)).rejects.toThrow(NotFoundException)
    await expect(service(db).resume(caller, 'w1')).rejects.toThrow(NotFoundException)
    expect(db.user.updateMany).not.toHaveBeenCalled()
  })

  it('quem chama sem empresa responde 404 sem consultar o alvo', async () => {
    const db = prismaDouble({ companyId: null, role: 'WORKER' }, null)

    await expect(service(db).pause({ ...caller, companyId: null }, 'w1', NOW)).rejects.toThrow(NotFoundException)
    expect(db.user.findUnique).not.toHaveBeenCalled()
  })
})
