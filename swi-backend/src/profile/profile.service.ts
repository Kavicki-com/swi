import { Injectable } from '@nestjs/common'
import { isStaffJobTitle } from '../common/staff'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma, Profile } from '@prisma/client'

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  getByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } })
  }

  upsert(userId: string, patch: Prisma.ProfileUpdateInput): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...patch } as Prisma.ProfileUncheckedCreateInput,
      update: patch,
    })
  }

  // Exames clínicos: nome, validade e arquivo. Validade mais distante primeiro,
  // que é a ordem em que o histórico é desenhado.
  listExams(userId: string) {
    return this.prisma.exam.findMany({ where: { userId }, orderBy: { date: 'desc' } })
  }

  addExam(userId: string, dto: { name: string; date: string; fileKey: string }) {
    return this.prisma.exam.create({
      data: { userId, name: dto.name, date: new Date(dto.date), fileKey: dto.fileKey },
    })
  }

  // deleteMany com o userId no filtro (e não delete por id): um id de outra
  // pessoa não apaga nada, em vez de apagar o exame alheio.
  async removeExam(userId: string, id: string): Promise<boolean> {
    const { count } = await this.prisma.exam.deleteMany({ where: { id, userId } })
    return count > 0
  }

  /**
   * Vocabulário REAL da organização: DISTINCT de jobTitle, sector e duty dos
   * Profiles da empresa do caller. Alimenta os Comboboxes do settings e o setor
   * do form de tarefas. Lista fixa no código diverge entre telas e não contém
   * os valores que existem no banco, então aqui só é oferecido o que existe. A
   * taxonomia curada vem quando o cliente definir a oficial.
   */
  async catalog(userId: string): Promise<{
    jobTitles: string[]
    sectors: string[]
    duties: string[]
    managers: string[]
  }> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    })
    // companyId null = balde legado (casa só com null) — mesma semântica da
    // org-scoping do resto do backend.
    const rows = await this.prisma.profile.findMany({
      where: { user: { companyId: me?.companyId ?? null } },
      // fullName e role entram por causa de `managers`: sem eles o catálogo não
      // tem de onde tirar a lista, e o combo "Gerente responsável" do app abre
      // vazio.
      select: { jobTitle: true, sector: true, duty: true, fullName: true, user: { select: { role: true, name: true } } },
    })
    const distinct = (pick: (r: (typeof rows)[number]) => string | null): string[] =>
      [...new Set(rows.map(pick).filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      )
    // Quem pode ser gerente responsável = a MESMA régua de staff que decide
    // quem revisa relatório (common/staff + role ADMIN). Uma definição só de
    // "quem é gestor": duas divergiriam na primeira contratação.
    const managers = [
      ...new Set(
        rows
          .filter((r) => r.user?.role === 'ADMIN' || isStaffJobTitle(r.jobTitle))
          .map((r) => (r.fullName?.trim() || r.user?.name?.trim() || ''))
          .filter(Boolean),
      ),
    ].sort((a, b) => a.localeCompare(b, 'pt-BR'))

    return {
      jobTitles: distinct((r) => r.jobTitle),
      sectors: distinct((r) => r.sector),
      duties: distinct((r) => r.duty),
      managers,
    }
  }
}
