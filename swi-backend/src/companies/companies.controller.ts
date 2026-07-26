import { Controller, Get } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { PrismaService } from '../prisma/prisma.service'

// Catálogo PÚBLICO de empresas — o cadastro do app acontece ANTES do login, e
// sem escolher a empresa o usuário nascia sem companyId: ficava invisível na
// fila de aprovação do painel (que é org-scoped) e o fluxo inteiro morria ali
// (QA 2026-07-26).
//
// Expõe SÓ id + nome. CNPJ, endereço e telefone do responsável ficam de fora:
// são dados da empresa, não precisam para escolher numa lista. O throttle
// evita que a rota vire enumeração barata da carteira de clientes.
@Controller('companies')
export class CompaniesController {
  constructor(private readonly prisma: PrismaService) {}

  @Throttle({ default: { limit: 20, ttl: 60000 } })
  @Get()
  list(): Promise<Array<{ id: string; name: string }>> {
    return this.prisma.company.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    })
  }
}
