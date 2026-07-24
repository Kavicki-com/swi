import { Body, Controller, Get, NotFoundException, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { ReportsService } from './reports.service'
import { CreateCommentDto, CreateReportDto, UpdateReportDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.reports.list(user.companyId)
  }

  @Get(':id')
  async get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    const r = await this.reports.get(id, user.companyId)
    if (!r) throw new NotFoundException('Relatório não encontrado')
    return r
  }

  @Post()
  create(@CurrentUserId() userId: string, @Body() dto: CreateReportDto) {
    return this.reports.create(userId, dto)
  }

  @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtUser, @Body() dto: UpdateReportDto) {
    return this.reports.update(id, user.userId, dto, user.companyId)
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @CurrentUserId() userId: string, @Body() dto: CreateCommentDto) {
    return this.reports.addComment(id, userId, dto)
  }
}
