import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common'
import type { RescueStatus } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import { JourneyService } from '../journey/journey.service'
import { NotificationService } from '../notifications/notification.service'

type Person = { id: string; name: string }

export type RescueDto = {
  id: string
  number: number
  status: RescueStatus
  startedAt: Date
  arrivedAt: Date | null
  endedAt: Date | null
  injured: Person
  rescuer: Person
}

type RescueWithPeople = {
  id: string
  number: number
  status: RescueStatus
  startedAt: Date
  arrivedAt: Date | null
  endedAt: Date | null
  injured: Person
  rescuer: Person
}

const withPeople = {
  injured: { select: { id: true, name: true } },
  rescuer: { select: { id: true, name: true } },
} as const

@Injectable()
export class RescueService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly journey: JourneyService,
    private readonly notifications: NotificationService,
  ) {}

  // Despacha um socorrista para um ferido: grava o resgate, pausa a jornada do
  // socorrista e o notifica. Os dois precisam ser WORKER da mesma empresa.
  async dispatch(companyId: string | null, injuredId: string, rescuerId: string): Promise<RescueDto> {
    const company = this.requireCompany(companyId)
    if (injuredId === rescuerId) throw new BadRequestException('O socorrista não pode ser o próprio ferido')

    const found = await this.prisma.user.findMany({
      where: { id: { in: [injuredId, rescuerId] }, companyId: company, role: 'WORKER' },
      select: { id: true, name: true },
    })
    if (found.length < 2) throw new NotFoundException('Ferido ou socorrista não encontrado na empresa')

    const rescue = await this.prisma.rescue.create({
      data: { companyId: company, injuredId, rescuerId },
      include: withPeople,
    })

    await this.journey.pauseJourney(rescuerId)
    await this.notifications.enqueueForMany([rescuerId], {
      domain: 'rescue',
      title: 'Rota de socorro',
      body: 'Você foi designado para um resgate. Seu tempo de trabalho fica pausado até o resgate chegar.',
      targetId: rescue.id,
    })

    return this.toDto(rescue)
  }

  async list(companyId: string | null): Promise<RescueDto[]> {
    if (!companyId) return []
    const rows = await this.prisma.rescue.findMany({
      where: { companyId },
      orderBy: { startedAt: 'desc' },
      include: withPeople,
    })
    return rows.map((r) => this.toDto(r))
  }

  // O modal promete que a jornada fica pausada até o resgate chegar: registrar a
  // chegada retoma a jornada do socorrista.
  async arrive(companyId: string | null, id: string): Promise<RescueDto> {
    const company = this.requireCompany(companyId)
    const current = await this.prisma.rescue.findFirst({
      where: { id, companyId: company },
      select: { id: true, status: true, rescuerId: true },
    })
    if (!current) throw new NotFoundException('Resgate não encontrado')
    if (current.status === 'ended') throw new ConflictException('Resgate já encerrado')

    const updated = await this.prisma.rescue.update({
      where: { id },
      data: { status: 'arrived', arrivedAt: new Date() },
      include: withPeople,
    })
    if (current.status === 'dispatched') await this.journey.resumeJourney(current.rescuerId)
    return this.toDto(updated)
  }

  // Encerra o atendimento. Se encerrou direto de dispatched (sem passar por
  // chegada), a jornada ainda está pausada e volta aqui.
  async end(companyId: string | null, id: string): Promise<RescueDto> {
    const company = this.requireCompany(companyId)
    const current = await this.prisma.rescue.findFirst({
      where: { id, companyId: company },
      select: { id: true, status: true, rescuerId: true },
    })
    if (!current) throw new NotFoundException('Resgate não encontrado')
    if (current.status === 'ended') throw new ConflictException('Resgate já encerrado')

    const updated = await this.prisma.rescue.update({
      where: { id },
      data: { status: 'ended', endedAt: new Date() },
      include: withPeople,
    })
    if (current.status === 'dispatched') await this.journey.resumeJourney(current.rescuerId)
    return this.toDto(updated)
  }

  private requireCompany(companyId: string | null): string {
    if (!companyId) throw new ForbiddenException('Usuário sem empresa vinculada')
    return companyId
  }

  private toDto(r: RescueWithPeople): RescueDto {
    return {
      id: r.id,
      number: r.number,
      status: r.status,
      startedAt: r.startedAt,
      arrivedAt: r.arrivedAt,
      endedAt: r.endedAt,
      injured: { id: r.injured.id, name: r.injured.name },
      rescuer: { id: r.rescuer.id, name: r.rescuer.name },
    }
  }
}
