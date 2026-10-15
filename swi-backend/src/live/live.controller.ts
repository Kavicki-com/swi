import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Can } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'
import { parseLiveIceServers } from '../config/runtime-env'
import { LiveService } from './live.service'

@ApiTags('live')
@ApiBearerAuth()
@Controller('live')
@UseGuards(JwtAuthGuard)
export class LiveController {
  constructor(private readonly live: LiveService) {}

  /** Quem está transmitindo agora na empresa do administrador. */
  @UseGuards(RolesGuard) @Can('monitoring.read') @Get()
  list(@CurrentUser() user: JwtUser) {
    return this.live.list(user.companyId)
  }

  /**
   * Servidores de conexão para o celular e o painel. A variável já foi
   * validada no boot; aqui ela só é lida de novo, como a retenção.
   */
  @Get('ice-servers')
  iceServers() {
    return { iceServers: parseLiveIceServers(process.env, []) }
  }
}
