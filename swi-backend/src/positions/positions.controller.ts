import { BadRequestException, Body, Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common'
import { PositionsService } from './positions.service'
import { PositionHistoryService } from './position-history.service'
import { HeartbeatDto, HeatQueryDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'
import { parsePositionsHeatIncludeSim } from '../config/runtime-env'

// Localização em tempo real. O heartbeat é do WORKER, ou seja, o app mobile (ou
// o simulador de dev) posta a própria posição; a listagem é do ADMIN, escopada
// na empresa dele. O throttle global de 100 por minuto comporta um heartbeat a
// cada 5 segundos.
@Controller('positions')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PositionsController {
  constructor(
    private readonly positions: PositionsService,
    private readonly history: PositionHistoryService,
  ) {}

  @Roles('WORKER') @Post('heartbeat') @HttpCode(204)
  heartbeat(@CurrentUser() user: JwtUser, @Body() dto: HeartbeatDto) {
    return this.positions.heartbeat(user.userId, dto.lat, dto.lng)
  }

  @Roles('ADMIN') @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.positions.listForCompany(user.companyId)
  }

  // Mapa de calor da empresa: células agregadas, nunca trilhas individuais.
  @Roles('ADMIN') @Get('heat')
  heat(@CurrentUser() user: JwtUser, @Query() query: HeatQueryDto) {
    // Lido a cada pedido, como as outras chaves de homologação: ligar ou
    // desligar no servidor não exige subir de novo.
    const simAllowed = parsePositionsHeatIncludeSim(process.env)
    if (query.source === 'all' && !simAllowed) {
      throw new BadRequestException('Posições do simulador só entram no mapa de calor da homologação')
    }
    return this.history.heat(
      user.companyId,
      { from: query.from, to: query.to },
      { includeSim: query.source === 'all' },
      new Date(),
    )
  }

  // Colegas no mapa do app: qualquer pessoa autenticada com empresa vê a
  // última posição recente dos outros funcionários da mesma empresa.
  @Get('colleagues')
  colleagues(@CurrentUser() user: JwtUser) {
    return this.positions.listColleagues(user, new Date())
  }
}
