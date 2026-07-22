import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { Role } from '@prisma/client'
import type { ApprovalStatus, Company, Profile, User } from '@prisma/client'

type UserWithProfile = User & { profile: Profile | null }
type UserWithProfileCompany = UserWithProfile & { company: Company | null }

const LIST_CAP = 200

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }) }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }

  async approve(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u) throw new NotFoundException('Usuário não encontrado')
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'APPROVED' } })
  }

  listPending() {
    return this.prisma.user.findMany({
      where: { approvalStatus: 'PENDING' },
      select: { id: true, email: true, name: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    })
  }

  async reject(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u) throw new NotFoundException('Usuário não encontrado')
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'REJECTED' } })
  }

  // Lista o diretório do painel (Colaboradores = role WORKER, Admins = role
  // ADMIN). Filtros opcionais; sem filtro devolve todos. Só campos de identidade
  // — vitais/saúde ficam por conta da smartband (mock no front até o hardware).
  async list(role?: Role, approvalStatus?: ApprovalStatus) {
    if (role !== undefined && !(role in Role)) throw new BadRequestException('role inválido')
    const users = await this.prisma.user.findMany({
      where: {
        ...(role !== undefined ? { role } : {}),
        ...(approvalStatus !== undefined ? { approvalStatus } : {}),
      },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: LIST_CAP,
    })
    return Promise.all(users.map((u) => this.toSummaryDto(u)))
  }

  async getOne(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true, company: true },
    })
    if (!user) throw new NotFoundException('Usuário não encontrado')
    return this.toDetailDto(user)
  }

  // Identidade + display (fullName ↔ name fallback, jobTitle/sector vazios quando
  // sem profile). birthDate em ISO (paridade com o Profile cru do wire, igual ao
  // toWorkerDto de work-orders); avatar assinado ('' sem key).
  private async toSummaryDto(u: UserWithProfile) {
    return {
      id: u.id,
      name: u.profile?.fullName ?? u.name,
      email: u.email,
      role: u.role,
      approvalStatus: u.approvalStatus,
      jobTitle: u.profile?.jobTitle ?? '',
      sector: u.profile?.sector ?? '',
      birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
      avatar: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
      companyRole: u.companyRole,
      createdAt: u.createdAt.toISOString(),
    }
  }

  private async toDetailDto(u: UserWithProfileCompany) {
    const summary = await this.toSummaryDto(u)
    return {
      ...summary,
      phone: u.profile?.phone ?? null,
      cpf: u.profile?.cpf ?? null,
      company: u.company ? { id: u.company.id, name: u.company.name } : null,
    }
  }
}
