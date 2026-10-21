import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common'
import { EvacuationService, parseFrom } from './evacuation.service'
import type { RouteProvider } from './evacuation.provider'
import type { PrismaService } from '../prisma/prisma.service'

// A rota da tela de evacuação sai de onde a pessoa está e vai ao ponto de
// encontro da evacuação ativa da empresa dela. Nada de pontos fixos do piloto.
const MUSTER: [number, number] = [-46.62, -23.544]
const HERE: [number, number] = [-46.632, -23.552]
const REAL = { waypoints: [HERE, MUSTER] as [number, number][], durationSec: 900, distanceM: 1200 }

interface MakeOptions {
  evac?: { musterPoint: unknown } | null
  position?: { lat: number; lng: number } | null
  fetch?: RouteProvider['fetch']
}

function make(opts: MakeOptions = {}) {
  const { evac = { musterPoint: MUSTER }, position = null, fetch = jest.fn(async () => REAL) } = opts
  const prisma = {
    evacuation: { findFirst: jest.fn(async () => evac) },
    workerPosition: { findFirst: jest.fn(async () => position) },
  }
  // `{ fetch }` já é um RouteProvider estrutural; o prisma é um recorte com os
  // dois findFirst que o service consulta.
  const service = new EvacuationService({ fetch }, prisma as unknown as PrismaService)
  return { service, prisma, fetch }
}
const user = { userId: 'w1', role: 'WORKER' as const, companyId: 'c1' }

describe('EvacuationService.getRoute', () => {
  it('com from: rota da posição enviada até o ponto de encontro', async () => {
    const { service, fetch, prisma } = make()
    const r = await service.getRoute(user, HERE)
    expect(prisma.evacuation.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { companyId: 'c1', status: 'ACTIVE' } }),
    )
    expect(fetch).toHaveBeenCalledWith({ origin: HERE, destination: MUSTER })
    expect(r).toMatchObject({ origin: HERE, destination: MUSTER, approximate: false, durationSec: 900 })
    expect(r.waypoints).toEqual(REAL.waypoints)
    expect(Number.isNaN(Date.parse(r.fetchedAt))).toBe(false)
  })

  it('sem from: usa a última posição real do backend', async () => {
    const { service, fetch } = make({ position: { lat: -23.55, lng: -46.63 } })
    await service.getRoute(user, null)
    expect(fetch).toHaveBeenCalledWith({ origin: [-46.63, -23.55], destination: MUSTER })
  })

  it('sem from e sem posição: 409', async () => {
    const { service } = make()
    await expect(service.getRoute(user, null)).rejects.toThrow(ConflictException)
  })

  it('sem evacuação ativa: 404', async () => {
    const { service } = make({ evac: null })
    await expect(service.getRoute(user, HERE)).rejects.toThrow(NotFoundException)
  })

  it('evacuação antiga sem ponto: 404', async () => {
    const { service } = make({ evac: { musterPoint: null } })
    await expect(service.getRoute(user, HERE)).rejects.toThrow(NotFoundException)
  })

  it('roteador fora: linha reta aproximada entre a posição e o ponto', async () => {
    const { service } = make({
      fetch: jest.fn(async () => {
        throw new Error('down')
      }),
    })
    const r = await service.getRoute(user, HERE)
    expect(r).toMatchObject({ waypoints: [HERE, MUSTER], approximate: true, origin: HERE, destination: MUSTER })
    expect(r.distanceM).toBeGreaterThan(1000)
    expect(r.durationSec).toBeGreaterThan(0)
  })
})

describe('parseFrom', () => {
  it('lê "lng,lat"', () => expect(parseFrom('-46.63,-23.55')).toEqual([-46.63, -23.55]))
  it('ausente é null', () => expect(parseFrom(undefined)).toBeNull())
  it('malformado ou fora do globo é 400', () => {
    expect(() => parseFrom('x')).toThrow(BadRequestException)
    expect(() => parseFrom('200,0')).toThrow(BadRequestException)
    expect(() => parseFrom('-46.63')).toThrow(BadRequestException)
    expect(() => parseFrom('-46.63,-23.55,1')).toThrow(BadRequestException)
  })
})
