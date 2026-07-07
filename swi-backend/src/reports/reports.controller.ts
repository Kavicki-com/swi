import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CreateCommentDto, CreateReportDto, UpdateReportDto } from './dto'
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

  @Patch(':id')
  async update(@Param('id') id: string, @Body() dto: UpdateReportDto) {
    const r = await this.reports.update(id, dto)
    if (!r) throw new NotFoundException('Relatório não encontrado')
    return r
  }

  @Post(':id/comments')
  async addComment(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: CreateCommentDto,
  ) {
    const c = await this.reports.addComment(id, userId, dto.text)
    if (!c) throw new NotFoundException('Relatório não encontrado')
    return c
  }
}
