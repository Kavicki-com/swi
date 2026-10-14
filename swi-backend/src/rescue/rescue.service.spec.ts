import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { RescueService } from './rescue.service'

// O resgate é da empresa: despacho, listagem e transições são filtrados pela
// empresa do token. O ferido e o socorrista precisam ser WORKER da mesma
// empresa. Despachar pausa a jornada do socorrista e o notifica; a jornada
// volta quando ele chega.

const injured = { id: 'ferido-1', name: 'Ana Ferida' }
const rescuer = { id: 'socorrista-1', name: 'Bruno Socorro' }

const row = {
  id: 'rescue-1',
  number: 1849,
  status: 'dispatched' as const,
  startedAt: new Date('2026-10-14T12:00:00Z'),
  arrivedAt: null as Date | null,
  endedAt: null as Date | null,
  injured,
  rescuer,
}

const prisma = (over: Record<string, unknown> = {}) =>
  ({
    user: {
      findMany: jest.fn().mockResolvedValue([
        { id: 'ferido-1', name: 'Ana Ferida' },
        { id: 'socorrista-1', name: 'Bruno Socorro' },
      ]),
    },
    rescue: {
      create: jest.fn().mockResolvedValue(row),
      findMany: jest.fn().mockResolvedValue([row]),
      findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'dispatched', rescuerId: 'socorrista-1' }),
      update: jest.fn().mockResolvedValue(row),
    },
    ...over,
  }) as any

const journey = () =>
  ({ pauseJourney: jest.fn().mockResolvedValue(undefined), resumeJourney: jest.fn().mockResolvedValue(undefined) }) as any

const notifications = () => ({ enqueueForMany: jest.fn().mockResolvedValue(undefined) }) as any

const make = (db = prisma(), j = journey(), n = notifications()) => ({
  svc: new RescueService(db, j, n),
  db,
  j,
  n,
})

describe('RescueService', () => {
  describe('dispatch', () => {
    it('grava o resgate na empresa, pausa a jornada do socorrista e o notifica', async () => {
      const { svc, db, j, n } = make()
      const out = await svc.dispatch('empresa-1', 'ferido-1', 'socorrista-1')

      // Confirma que os dois são WORKER da empresa antes de gravar.
      expect(db.user.findMany.mock.calls[0][0].where).toEqual({
        id: { in: ['ferido-1', 'socorrista-1'] },
        companyId: 'empresa-1',
        role: 'WORKER',
      })
      expect(db.rescue.create.mock.calls[0][0].data).toEqual({
        companyId: 'empresa-1',
        injuredId: 'ferido-1',
        rescuerId: 'socorrista-1',
      })
      expect(j.pauseJourney).toHaveBeenCalledWith('socorrista-1')
      expect(n.enqueueForMany.mock.calls[0][0]).toEqual(['socorrista-1'])
      expect(n.enqueueForMany.mock.calls[0][1].domain).toBe('rescue')
      expect(n.enqueueForMany.mock.calls[0][1].targetId).toBe('rescue-1')
      expect(out).toEqual({
        id: 'rescue-1',
        number: 1849,
        status: 'dispatched',
        startedAt: row.startedAt,
        arrivedAt: null,
        endedAt: null,
        injured: { id: 'ferido-1', name: 'Ana Ferida' },
        rescuer: { id: 'socorrista-1', name: 'Bruno Socorro' },
      })
    })

    it('sem empresa no token não despacha: 403', async () => {
      const { svc } = make()
      await expect(svc.dispatch(null, 'ferido-1', 'socorrista-1')).rejects.toBeInstanceOf(ForbiddenException)
    })

    it('ninguém socorre a si mesmo: 400', async () => {
      const { svc, db } = make()
      await expect(svc.dispatch('empresa-1', 'ferido-1', 'ferido-1')).rejects.toBeInstanceOf(BadRequestException)
      expect(db.rescue.create).not.toHaveBeenCalled()
    })

    it('ferido ou socorrista fora da empresa, inexistente ou não-WORKER: 404', async () => {
      const db = prisma({ user: { findMany: jest.fn().mockResolvedValue([{ id: 'ferido-1', name: 'Ana Ferida' }]) } })
      const { svc } = make(db)
      await expect(svc.dispatch('empresa-1', 'ferido-1', 'socorrista-x')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.rescue.create).not.toHaveBeenCalled()
    })
  })

  describe('list', () => {
    it('lista os resgates da empresa, mais recentes primeiro, com os nomes', async () => {
      const { svc, db } = make()
      const out = await svc.list('empresa-1')
      const args = db.rescue.findMany.mock.calls[0][0]
      expect(args.where).toEqual({ companyId: 'empresa-1' })
      expect(args.orderBy).toEqual({ startedAt: 'desc' })
      expect(out).toEqual([
        {
          id: 'rescue-1',
          number: 1849,
          status: 'dispatched',
          startedAt: row.startedAt,
          arrivedAt: null,
          endedAt: null,
          injured: { id: 'ferido-1', name: 'Ana Ferida' },
          rescuer: { id: 'socorrista-1', name: 'Bruno Socorro' },
        },
      ])
    })

    it('sem empresa não há o que listar: lista vazia, sem consultar', async () => {
      const { svc, db } = make()
      expect(await svc.list(null)).toEqual([])
      expect(db.rescue.findMany).not.toHaveBeenCalled()
    })
  })

  describe('arrive', () => {
    it('marca chegada e retoma a jornada do socorrista (a pausa valia até chegar)', async () => {
      const arrivedRow = { ...row, status: 'arrived', arrivedAt: new Date('2026-10-14T12:30:00Z') }
      const db = prisma({
        rescue: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'dispatched', rescuerId: 'socorrista-1' }),
          update: jest.fn().mockResolvedValue(arrivedRow),
        },
      })
      const { svc, j } = make(db)
      const out = await svc.arrive('empresa-1', 'rescue-1')
      expect(db.rescue.findFirst.mock.calls[0][0].where).toEqual({ id: 'rescue-1', companyId: 'empresa-1' })
      expect(db.rescue.update.mock.calls[0][0].data.status).toBe('arrived')
      expect(db.rescue.update.mock.calls[0][0].data.arrivedAt).toBeInstanceOf(Date)
      expect(j.resumeJourney).toHaveBeenCalledWith('socorrista-1')
      expect(out.status).toBe('arrived')
    })

    it('resgate de outra empresa ou inexistente: 404', async () => {
      const db = prisma({ rescue: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } })
      const { svc } = make(db)
      await expect(svc.arrive('empresa-1', 'rescue-x')).rejects.toBeInstanceOf(NotFoundException)
      expect(db.rescue.update).not.toHaveBeenCalled()
    })

    it('resgate já encerrado não registra chegada: 409', async () => {
      const db = prisma({
        rescue: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'ended', rescuerId: 'socorrista-1' }),
          update: jest.fn(),
        },
      })
      const { svc } = make(db)
      await expect(svc.arrive('empresa-1', 'rescue-1')).rejects.toBeInstanceOf(ConflictException)
    })
  })

  describe('end', () => {
    it('encerra vindo de dispatched e retoma a jornada (encerrou sem passar por chegada)', async () => {
      const endedRow = { ...row, status: 'ended', endedAt: new Date('2026-10-14T13:00:00Z') }
      const db = prisma({
        rescue: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'dispatched', rescuerId: 'socorrista-1' }),
          update: jest.fn().mockResolvedValue(endedRow),
        },
      })
      const { svc, j } = make(db)
      const out = await svc.end('empresa-1', 'rescue-1')
      expect(db.rescue.update.mock.calls[0][0].data.status).toBe('ended')
      expect(db.rescue.update.mock.calls[0][0].data.endedAt).toBeInstanceOf(Date)
      expect(j.resumeJourney).toHaveBeenCalledWith('socorrista-1')
      expect(out.status).toBe('ended')
    })

    it('encerra vindo de arrived sem retomar de novo: a jornada já havia voltado', async () => {
      const endedRow = { ...row, status: 'ended', endedAt: new Date('2026-10-14T13:00:00Z') }
      const db = prisma({
        rescue: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'arrived', rescuerId: 'socorrista-1' }),
          update: jest.fn().mockResolvedValue(endedRow),
        },
      })
      const { svc, j } = make(db)
      await svc.end('empresa-1', 'rescue-1')
      expect(j.resumeJourney).not.toHaveBeenCalled()
    })

    it('resgate de outra empresa ou inexistente: 404', async () => {
      const db = prisma({ rescue: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() } })
      const { svc } = make(db)
      await expect(svc.end('empresa-1', 'rescue-x')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('resgate já encerrado: 409', async () => {
      const db = prisma({
        rescue: {
          findFirst: jest.fn().mockResolvedValue({ id: 'rescue-1', status: 'ended', rescuerId: 'socorrista-1' }),
          update: jest.fn(),
        },
      })
      const { svc } = make(db)
      await expect(svc.end('empresa-1', 'rescue-1')).rejects.toBeInstanceOf(ConflictException)
    })

    it('sem empresa: 403', async () => {
      const { svc } = make()
      await expect(svc.end(null, 'rescue-1')).rejects.toBeInstanceOf(ForbiddenException)
    })
  })
})
