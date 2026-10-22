import { Controller, Get, Headers, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Roles } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { parseIdempotencyKey } from '../../idempotency/idempotency-key'
import { HelpRequestService, type HelpRequestView } from './help-request.service'

// Pedido de ajuda do botão "Ajuda urgente" do app. Só o funcionário pede, e só
// lê o próprio pedido: quem é o funcionário sai do token, nunca do corpo. A
// equipe do painel trata o pedido pela fila de alertas e pelos resgates.
@ApiTags('help-requests')
@ApiBearerAuth()
@Controller('help-requests')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('WORKER')
export class HelpRequestController {
  constructor(private readonly helpRequests: HelpRequestService) {}

  /**
   * Pede ajuda. Com um pedido aberto ou atendido, devolve o mesmo em vez de
   * abrir outro. `Idempotency-Key` (UUID v4) é opcional, para a fila offline.
   */
  @Post()
  request(@CurrentUser() user: JwtUser, @Headers('idempotency-key') rawKey?: string): Promise<HelpRequestView> {
    return this.helpRequests.request(user.userId, parseIdempotencyKey(rawKey))
  }

  /** O pedido mais recente do próprio funcionário, em qualquer estado; `helpRequest` nulo se nunca pediu. */
  @Get('mine')
  async mine(@CurrentUser() user: JwtUser): Promise<{ helpRequest: HelpRequestView | null }> {
    return { helpRequest: await this.helpRequests.mine(user.userId) }
  }
}
