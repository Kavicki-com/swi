import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common'
import type { Response } from 'express'
import { ReportsService } from './reports.service'
import { CreateCommentDto, CreateReportDto, UpdateReportDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

@Controller('reports')
@UseGuards(JwtAuthGuard)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  // Resposta segue sendo o ARRAY de sempre (mobile intacto); o total da empresa
  // viaja no header X-Total-Count pra UI saber quantos ficaram fora da página.
  // `limit`/`offset` são opcionais — sem eles, o comportamento é o de antes.
  @Get()
  async list(
    @CurrentUser() user: JwtUser,
    @Res({ passthrough: true }) res: Response,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    const { items, total } = await this.reports.list(user.companyId, {
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    })
    res.setHeader('X-Total-Count', String(total))
    // Sem isto o browser não enxerga o header (CORS esconde tudo fora da lista segura).
    res.setHeader('Access-Control-Expose-Headers', 'X-Total-Count')
    return items
  }

  // ANTES de @Get(':id') de propósito: o Nest casa na ordem de declaração, e
  // invertido 'assignees' viraria um id e responderia "Relatório não
  // encontrado".
  //
  // Quem pode ser atribuído como responsável — staff da empresa. O app pedia
  // isso ao /chat/directory, que devolve todo mundo (inclusive os operadores),
  // porque /users é @Roles('ADMIN') e o worker não alcança.
  @Get('assignees')
  listAssignees(@CurrentUser() user: JwtUser) {
    return this.reports.listAssignees(user.userId, user.companyId)
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

  // Exclusão (204). A régua de quem pode vive no serviço (autor ou ADMIN), e
  // por isso o papel do token viaja junto: sem ele não haveria como distinguir
  // um admin excluindo o relatório de outra pessoa de um worker qualquer.
  @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.reports.remove(id, user.userId, user.role, user.companyId)
  }

  @Post(':id/comments')
  addComment(@Param('id') id: string, @CurrentUserId() userId: string, @Body() dto: CreateCommentDto) {
    return this.reports.addComment(id, userId, dto)
  }
}
