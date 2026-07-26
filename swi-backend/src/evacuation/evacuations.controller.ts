import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { EvacuationEventsService } from './evacuation-events.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

// Fase 2 do realtime: evacuação real. Dispatch/encerramento/progresso são do
// ADMIN (org-scoped); o ack é do WORKER (app mobile — ou simulador dev).
// Plural /evacuations de propósito: /evacuation/route (passthrough da rota
// de fuga pro mobile) é outro recurso e continua intocado.
@Controller('evacuations')
@UseGuards(JwtAuthGuard, RolesGuard)
export class EvacuationsController {
  constructor(private readonly events: EvacuationEventsService) {}

  @Roles('ADMIN') @Post()
  start(@CurrentUser() user: JwtUser) {
    return this.events.start(user.userId, user.companyId)
  }

  // WORKER também lê: o app mobile precisa da ativa da PRÓPRIA org pra saber
  // o que confirmar (ack) — org-scoping idêntico ao do admin.
  @Roles('ADMIN', 'WORKER') @Get('active')
  active(@CurrentUser() user: JwtUser) {
    return this.events.active(user.companyId)
  }

  @Roles('WORKER') @Post(':id/ack') @HttpCode(204)
  ack(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.events.ack(user.userId, id)
  }

  @Roles('ADMIN') @Post(':id/end') @HttpCode(204)
  end(@CurrentUser() user: JwtUser, @Param('id') id: string) {
    return this.events.end(user.companyId, id)
  }
}
