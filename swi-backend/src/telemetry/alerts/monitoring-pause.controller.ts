import { Controller, Delete, Param, Put, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Can } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { MonitoringPauseService, type MonitoringPauseState } from './monitoring-pause.service'

// Pausa dos alertas de um funcionário, do toggle do cartão do Monitoramento.
// PUT pausa e DELETE retoma; as duas devolvem o estado já gravado. O estado
// também chega em `monitoringPausedAt` na lista e no detalhe de /users.
@ApiTags('telemetry/alerts')
@ApiBearerAuth()
@Controller('telemetry/v1/workers/:id/monitoring-pause')
@UseGuards(JwtAuthGuard, RolesGuard)
@Can('monitoring.pause')
export class MonitoringPauseController {
  constructor(private readonly pauses: MonitoringPauseService) {}

  /** Pausa os alertas: a telemetria segue gravada, nenhuma condição nova nasce. */
  @Put()
  pause(@CurrentUser() caller: JwtUser, @Param('id') workerId: string): Promise<MonitoringPauseState> {
    return this.pauses.pause(caller, workerId)
  }

  /** Retoma os alertas a partir de agora, sem olhar o que chegou durante a pausa. */
  @Delete()
  resume(@CurrentUser() caller: JwtUser, @Param('id') workerId: string): Promise<MonitoringPauseState> {
    return this.pauses.resume(caller, workerId)
  }
}
