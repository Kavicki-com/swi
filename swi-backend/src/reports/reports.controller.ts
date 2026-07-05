import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CreateReportDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list() {
    return this.reports.list()
  }

  @Get(':id')
  async get(@Param('id') id: string) {
    const r = await this.reports.get(id)
    if (!r) throw new NotFoundException('Relatório não encontrado')
    return r
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateReportDto) {
    return this.reports.create(userId, dto)
  }
}
