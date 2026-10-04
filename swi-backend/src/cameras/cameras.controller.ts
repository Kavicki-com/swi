import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { CamerasService } from './cameras.service'
import { CreateCameraDto, UpdateCameraDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

// Qualquer usuário logado lê os pontos da própria empresa, para os mapas do
// painel e do app. Cadastrar, alterar e excluir é do ADMIN.
@Controller('cameras')
@UseGuards(JwtAuthGuard)
export class CamerasController {
  constructor(private readonly cameras: CamerasService) {}

  @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.cameras.list(user.companyId, user.role)
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateCameraDto) {
    return this.cameras.create(user.companyId, dto)
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Patch(':id')
  update(@Param('id') id: string, @CurrentUser() user: JwtUser, @Body() dto: UpdateCameraDto) {
    return this.cameras.update(id, user.companyId, dto)
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.cameras.remove(id, user.companyId)
  }
}
