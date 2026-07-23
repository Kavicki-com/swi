import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { hash } from '../auth/codes'
import { Prisma, Role } from '@prisma/client'
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

  // Cadastro pelo painel: o admin define a senha e o usuário nasce pronto pra
  // logar (APPROVED + emailVerified) — sem código de confirmação. Herda a empresa
  // do admin logado (null se ele não tiver). Reusa o hash bcrypt do módulo auth.
  async create(
    adminId: string,
    dto: { name: string; email: string; password: string; role: Role; phone?: string; cpf?: string; birthDate?: string },
  ) {
    const exists = await this.findByEmail(dto.email)
    if (exists) throw new ConflictException('E-mail já cadastrado')
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { companyId: true } })
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash: await hash(dto.password),
          role: dto.role,
          approvalStatus: 'APPROVED',
          emailVerified: true,
          companyId: admin?.companyId ?? null,
          profile: {
            create: {
              fullName: dto.name,
              ...(dto.phone ? { phone: dto.phone } : {}),
              ...(dto.cpf ? { cpf: dto.cpf } : {}),
              ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
            },
          },
        },
        include: { profile: true },
      })
      return this.toSummaryDto(user)
    } catch (e) {
      // Rede de segurança pra corrida: se dois creates concorrentes passarem o
      // pré-check, o segundo bate no unique de email (P2002) → traduz pra 409.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('E-mail já cadastrado')
      }
      throw e
    }
  }

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

  // Ativar/desativar: usuário inativo não loga (guarda no AuthService.login) e
  // tem a sessão revogada na hora (JwtStrategy reconsulta o banco). Aditivo e
  // reversível — não apaga nada. Guarda de auto-desativação: como o self-delete
  // do remove, o admin não pode se auto-trancar (reativar a si mesmo é ok).
  async setActive(id: string, active: boolean, requesterId: string) {
    if (id === requesterId && active === false) throw new BadRequestException('Não é possível desativar a si mesmo')
    try {
      const u = await this.prisma.user.update({ where: { id }, data: { active } })
      return { id: u.id, active: u.active }
    } catch (e) {
      // sem exception filter global: sem isto, P2025 (id inexistente) vira 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Usuário não encontrado')
      throw e
    }
  }

  // Exclusão dura: apaga o Profile (1:1) e o User na mesma transação. Guardas:
  // não deixa o admin excluir a si mesmo; se o User tiver registros vinculados
  // por FK (P2003, ex.: reports/journeys) orienta a desativar em vez de excluir.
  async remove(id: string, requesterId: string) {
    if (id === requesterId) throw new BadRequestException('Não é possível excluir a si mesmo')
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.profile.deleteMany({ where: { userId: id } })
        await tx.user.delete({ where: { id } })
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') throw new NotFoundException('Usuário não encontrado')
        if (e.code === 'P2003') throw new ConflictException('Usuário possui registros vinculados; desative-o em vez de excluir')
      }
      throw e
    }
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
      active: u.active,
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
