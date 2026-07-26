import { Injectable } from '@nestjs/common'
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

  /**
   * Vocabulário REAL da organização: DISTINCT de jobTitle/sector/duty dos
   * Profiles da empresa do caller. Alimenta os Comboboxes do settings e o
   * setor do form de tarefas — que usavam listas fixas inventadas, divergentes
   * entre telas e sem os valores do banco ('Administrador'/'Gestão' não
   * existiam em lista nenhuma; QA 2026-07-26). Só oferece o que existe; a
   * taxonomia curada vem quando o cliente definir a oficial.
   */
  async catalog(userId: string): Promise<{
    jobTitles: string[]
    sectors: string[]
    duties: string[]
  }> {
    const me = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { companyId: true },
    })
    // companyId null = balde legado (casa só com null) — mesma semântica da
    // org-scoping do resto do backend.
    const rows = await this.prisma.profile.findMany({
      where: { user: { companyId: me?.companyId ?? null } },
      select: { jobTitle: true, sector: true, duty: true },
    })
    const distinct = (pick: (r: (typeof rows)[number]) => string | null): string[] =>
      [...new Set(rows.map(pick).filter((v): v is string => Boolean(v && v.trim())))].sort((a, b) =>
        a.localeCompare(b, 'pt-BR'),
      )
    return {
      jobTitles: distinct((r) => r.jobTitle),
      sectors: distinct((r) => r.sector),
      duties: distinct((r) => r.duty),
    }
  }
}
