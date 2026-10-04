import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { CamerasService } from './cameras.service'

// Os pontos de câmera são da empresa: cada leitura e escrita é filtrada pela
// empresa do token, e câmera de outra empresa é invisível (404, não 403).

const row = {
  id: 'cam-1',
  name: 'Portaria',
  lat: -3.1,
  lng: -60.02,
  url: 'https://cameras.exemplo.com.br/portaria',
  createdAt: new Date('2026-01-01T12:00:00Z'),
  updatedAt: new Date('2026-01-01T12:00:00Z'),
}

const prisma = () =>
  ({
    camera: {
      findMany: jest.fn().mockResolvedValue([row]),
      findUnique: jest.fn().mockResolvedValue(row),
      create: jest.fn().mockResolvedValue(row),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
  }) as any

const unique = () => new Prisma.PrismaClientKnownRequestError('unique', { code: 'P2002', clientVersion: 'x' })

describe('CamerasService', () => {
  describe('list', () => {
    it('administrador lê os pontos da empresa com o endereço, em ordem de nome', async () => {
      const db = prisma()
      const out = await new CamerasService(db).list('empresa-1', 'ADMIN')
      const args = db.camera.findMany.mock.calls[0][0]
      expect(args.where).toEqual({ companyId: 'empresa-1' })
      expect(args.orderBy).toEqual({ name: 'asc' })
      expect(args.select.url).toBe(true)
      expect(args.select.companyId).toBeUndefined()
      expect(out).toEqual([row])
    })

    it('funcionário lê só nome e posição: o endereço pode carregar acesso', async () => {
      const db = prisma()
      await new CamerasService(db).list('empresa-1', 'WORKER')
      const { select } = db.camera.findMany.mock.calls[0][0]
      expect(select).toEqual({ id: true, name: true, lat: true, lng: true })
    })

    it('sem empresa não há pontos a mostrar: lista vazia, sem consultar', async () => {
      const db = prisma()
      expect(await new CamerasService(db).list(null, 'ADMIN')).toEqual([])
      expect(db.camera.findMany).not.toHaveBeenCalled()
    })
  })

  describe('create', () => {
    it('grava na empresa do token, endereço ausente vira nulo', async () => {
      const db = prisma()
      await new CamerasService(db).create('empresa-1', { name: 'Portaria', lat: -3.1, lng: -60.02 })
      expect(db.camera.create.mock.calls[0][0].data).toEqual({
        companyId: 'empresa-1', name: 'Portaria', lat: -3.1, lng: -60.02, url: null,
      })
    })

    it('sem empresa → 403', async () => {
      await expect(new CamerasService(prisma()).create(null, { name: 'P', lat: 0, lng: 0 }))
        .rejects.toBeInstanceOf(ForbiddenException)
    })

    it('nome repetido na empresa → 409', async () => {
      const db = prisma()
      db.camera.create.mockRejectedValue(unique())
      await expect(new CamerasService(db).create('empresa-1', { name: 'Portaria', lat: 0, lng: 0 }))
        .rejects.toBeInstanceOf(ConflictException)
    })

    it('outro erro do banco sobe como veio', async () => {
      const db = prisma()
      const boom = new Error('conexão caiu')
      db.camera.create.mockRejectedValue(boom)
      await expect(new CamerasService(db).create('empresa-1', { name: 'P', lat: 0, lng: 0 })).rejects.toBe(boom)
    })
  })

  describe('update', () => {
    it('altera só os campos enviados, filtrando pela empresa, e devolve a câmera', async () => {
      const db = prisma()
      const out = await new CamerasService(db).update('cam-1', 'empresa-1', { name: 'Pátio', url: null })
      expect(db.camera.updateMany).toHaveBeenCalledWith({
        where: { id: 'cam-1', companyId: 'empresa-1' },
        data: { name: 'Pátio', url: null },
      })
      expect(out).toEqual(row)
    })

    it('câmera de outra empresa ou inexistente → 404', async () => {
      const db = prisma()
      db.camera.updateMany.mockResolvedValue({ count: 0 })
      await expect(new CamerasService(db).update('cam-x', 'empresa-1', { name: 'P' }))
        .rejects.toBeInstanceOf(NotFoundException)
    })

    it('apagada logo depois de alterar → 404, não resposta vazia', async () => {
      const db = prisma()
      db.camera.findUnique.mockResolvedValue(null)
      await expect(new CamerasService(db).update('cam-1', 'empresa-1', { name: 'P' }))
        .rejects.toBeInstanceOf(NotFoundException)
    })

    it('nome que já existe na empresa → 409', async () => {
      const db = prisma()
      db.camera.updateMany.mockRejectedValue(unique())
      await expect(new CamerasService(db).update('cam-1', 'empresa-1', { name: 'Pátio' }))
        .rejects.toBeInstanceOf(ConflictException)
    })

    it('sem empresa → 403', async () => {
      await expect(new CamerasService(prisma()).update('cam-1', null, { name: 'P' }))
        .rejects.toBeInstanceOf(ForbiddenException)
    })
  })

  describe('remove', () => {
    it('apaga filtrando pela empresa', async () => {
      const db = prisma()
      await new CamerasService(db).remove('cam-1', 'empresa-1')
      expect(db.camera.deleteMany).toHaveBeenCalledWith({ where: { id: 'cam-1', companyId: 'empresa-1' } })
    })

    it('câmera de outra empresa, inexistente ou já apagada → 404', async () => {
      const db = prisma()
      db.camera.deleteMany.mockResolvedValue({ count: 0 })
      await expect(new CamerasService(db).remove('cam-x', 'empresa-1')).rejects.toBeInstanceOf(NotFoundException)
    })

    it('sem empresa → 403', async () => {
      await expect(new CamerasService(prisma()).remove('cam-1', null)).rejects.toBeInstanceOf(ForbiddenException)
    })
  })
})
