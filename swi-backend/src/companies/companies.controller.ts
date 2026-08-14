import { Controller, Get } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { PrismaService } from '../prisma/prisma.service'

// Catálogo PÚBLICO de empresas. O cadastro do app acontece ANTES do login, e
// sem escolher a empresa o usuário nasce sem companyId: fica invisível na fila
// de aprovação do painel, que é escopada por empresa, e o fluxo inteiro morre
// ali.
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
