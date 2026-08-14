import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { HeartbeatDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

// Localização em tempo real. O heartbeat é do WORKER, ou seja, o app mobile (ou
// o simulador de dev) posta a própria posição; a listagem é do ADMIN, escopada
// na empresa dele. O throttle global de 100 por minuto comporta um heartbeat a
// cada 5 segundos.
@Controller('positions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PositionsController {
  constructor(private readonly positions: PositionsService) {}

  @Roles('WORKER') @Post('heartbeat') @HttpCode(204)
  heartbeat(@CurrentUser() user: JwtUser, @Body() dto: HeartbeatDto) {
    return this.positions.heartbeat(user.userId, dto.lat, dto.lng)
  }

  @Roles('ADMIN') @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.positions.listForCompany(user.companyId)
  }
}
