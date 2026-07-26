import { Module } from '@nestjs/common'
import { CompaniesController } from './companies.controller'

// Sem service próprio: a única rota é um findMany de 2 colunas. Se aparecer
// regra de negócio (filtro por status, busca), extrair pra CompaniesService.
@Module({ controllers: [CompaniesController] })
export class CompaniesModule {}
