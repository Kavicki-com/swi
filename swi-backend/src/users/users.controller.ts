import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUserId } from '../auth/current-user.decorator'
import { CreateUserDto, SetActiveDto } from './dto'
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
  list(@Query('role') role?: string, @Query('approvalStatus') approvalStatus?: string) {
    return this.users.list(role as Role | undefined, approvalStatus as ApprovalStatus | undefined)
  }

  // Declarado ANTES de :id — senão o Nest casaria "pending" como um :id.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get('pending')
  listPending() { return this.users.listPending() }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get(':id')
  getOne(@Param('id') id: string) { return this.users.getOne(id) }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string) { const u = await this.users.approve(id); return { id: u.id, approvalStatus: u.approvalStatus } }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/reject') @HttpCode(200)
  async reject(@Param('id') id: string) { const u = await this.users.reject(id); return { id: u.id, approvalStatus: u.approvalStatus } }

  // Ativar/desativar: usuário inativo não loga (guarda no AuthService.login).
  // requesterId barra a auto-desativação no service.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Patch(':id')
  setActive(@Param('id') id: string, @Body() dto: SetActiveDto, @CurrentUserId() requesterId: string) { return this.users.setActive(id, dto.active, requesterId) }

  // Exclusão dura (204). requesterId barra auto-exclusão no service.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUserId() requesterId: string) { return this.users.remove(id, requesterId) }
}
