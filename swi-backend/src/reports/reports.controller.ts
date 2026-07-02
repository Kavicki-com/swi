import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CreateReportDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

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
  create(@Req() req: any, @Body() dto: CreateReportDto) {
    return this.reports.create(req.user.userId, dto)
  }
}
