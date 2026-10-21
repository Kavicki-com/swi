import { Controller, Get, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger'
import { EvacuationService, parseFrom } from './evacuation.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

@ApiTags('evacuation')
@ApiBearerAuth()
@Controller('evacuation')
@UseGuards(JwtAuthGuard)
export class EvacuationController {
  constructor(private readonly evacuation: EvacuationService) {}

  // Rota da posição de quem pede até o ponto de encontro da evacuação ativa.
  // 404 sem evacuação ativa com ponto; 409 sem posição conhecida.
  @ApiQuery({ name: 'from', required: false, description: 'Posição atual "lng,lat" (GPS do app)' })
  @Get('route')
  getRoute(@CurrentUser() user: JwtUser, @Query('from') from?: string) {
    return this.evacuation.getRoute(user, parseFrom(from))
  }
}
