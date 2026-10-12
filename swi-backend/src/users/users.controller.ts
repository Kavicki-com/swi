import { Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'
import { CreateUserDto, UpdateUserDto } from './dto'
import { CreateExamDto } from '../profile/dto'
import type { ApprovalStatus, Role } from '@prisma/client'

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  // Cadastro pelo painel: cria WORKER/ADMIN com senha do admin, já APPROVED +
  // verificado (loga na hora). Herda a empresa do admin logado.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post()
  create(@CurrentUserId() adminId: string, @Body() dto: CreateUserDto) {
    return this.users.create(adminId, dto)
  }

  // Diretório do painel: Colaboradores (?role=WORKER) e Admins (?role=ADMIN).
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get()
  list(@CurrentUser() user: JwtUser, @Query('role') role?: string, @Query('approvalStatus') approvalStatus?: string) {
    return this.users.list(user.companyId, role as Role | undefined, approvalStatus as ApprovalStatus | undefined)
  }

  // Declarado ANTES de :id — senão o Nest casaria "pending" como um :id.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get('pending')
  listPending(@CurrentUser() user: JwtUser) { return this.users.listPending(user.companyId) }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get(':id')
  getOne(@Param('id') id: string, @CurrentUser() user: JwtUser) { return this.users.getOne(id, user.companyId) }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string, @CurrentUser() user: JwtUser) { const u = await this.users.approve(id, user.companyId); return { id: u.id, approvalStatus: u.approvalStatus } }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/reject') @HttpCode(200)
  async reject(@Param('id') id: string, @CurrentUser() user: JwtUser) { const u = await this.users.reject(id, user.companyId); return { id: u.id, approvalStatus: u.approvalStatus } }

  // Edição de cadastro + ativar/desativar. Usuário inativo não loga (guarda no
  // AuthService.login) e tem a sessão revogada na hora; requesterId barra a
  // auto-desativação no service. E-mail e papel não passam por aqui: o
  // ValidationPipe global roda com whitelist e descarta o que não está no DTO.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateUserDto, @CurrentUser() user: JwtUser) { return this.users.update(id, dto, user.userId, user.companyId) }

  // Exame anexado pelo admin ao cadastro de OUTRA pessoa. O /profile/exams
  // grava sempre no usuário da sessão; esta rota é a que faltava pro formulário
  // do painel poder anexar o laudo de quem está sendo cadastrado. Reusa o
  // CreateExamDto do profile: mesma tabela, mesmas réguas (prefixo exams/ e
  // validade como data de calendário).
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/exams') @HttpCode(201)
  addExam(@Param('id') id: string, @Body() dto: CreateExamDto, @CurrentUser() user: JwtUser) {
    return this.users.addExam(id, dto, user.companyId)
  }

  // Exclusão do laudo do cadastro de outra pessoa (204). Par do Post acima; o
  // /profile/exams/:id só apaga do usuário da sessão. Exame de outra empresa é
  // invisível (404, não 403), mesma semântica de escopo do resto do backend.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Delete(':id/exams/:examId') @HttpCode(204)
  async removeExam(
    @Param('id') id: string,
    @Param('examId') examId: string,
    @CurrentUser() user: JwtUser,
  ) {
    if (!(await this.users.removeExam(id, examId, user.companyId))) {
      throw new NotFoundException('Exame não encontrado')
    }
  }

  // Exclusão dura (204). requesterId barra auto-exclusão no service.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) { return this.users.remove(id, user.userId, user.companyId) }
}
