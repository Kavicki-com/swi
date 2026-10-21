import { Body, Controller, Delete, Get, Param, ParseEnumPipe, Put, Query, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { CalibrationMetric, SafetyRule } from '@prisma/client'
import { CurrentUser, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Can } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { CalibrationAdminService } from './calibration-admin.service'
import { BandOverrideDto, CalibrationHistoryQueryDto, SafetyLimitDto } from './dto/calibration.dto'

// Calibração individual no painel: ver a régua da pessoa, corrigir a faixa de
// uma medição (admin e supervisor) e as travas de segurança (só admin). Toda
// escrita devolve o detalhe já atualizado. Remover o que não existe responde
// 200 com o detalhe como está, sem histórico.
@ApiTags('telemetry/calibration')
@ApiBearerAuth()
@Controller('telemetry/v1')
@UseGuards(JwtAuthGuard, RolesGuard)
export class CalibrationController {
  constructor(private readonly calibration: CalibrationAdminService) {}

  /** Fase, régua, faixas por medição e travas de um funcionário. */
  @Can('monitoring.read')
  @Get('workers/:id/calibration')
  detail(@CurrentUser() caller: JwtUser, @Param('id') workerId: string) {
    return this.calibration.detail(caller, workerId)
  }

  /** Histórico de mudanças, 50 por página, do mais novo ao mais antigo. */
  @Can('monitoring.read')
  @Get('workers/:id/calibration/history')
  history(@CurrentUser() caller: JwtUser, @Param('id') workerId: string, @Query() query: CalibrationHistoryQueryDto) {
    return this.calibration.history(caller, workerId, query.cursor)
  }

  /** Corrige a faixa de uma medição; o recálculo diário não mexe na correção. */
  @Can('monitoring.bands.manage')
  @Put('workers/:id/calibration/bands/:metric')
  setBand(
    @CurrentUser() caller: JwtUser,
    @Param('id') workerId: string,
    @Param('metric', new ParseEnumPipe(CalibrationMetric)) metric: CalibrationMetric,
    @Body() body: BandOverrideDto,
  ) {
    return this.calibration.setBand(caller, workerId, metric, body.cuts)
  }

  /** Remove a correção: a faixa volta ao aprendido. */
  @Can('monitoring.bands.manage')
  @Delete('workers/:id/calibration/bands/:metric')
  clearBand(
    @CurrentUser() caller: JwtUser,
    @Param('id') workerId: string,
    @Param('metric', new ParseEnumPipe(CalibrationMetric)) metric: CalibrationMetric,
  ) {
    return this.calibration.clearBand(caller, workerId, metric)
  }

  /** Grava a trava personalizada da regra. */
  @Can('monitoring.safety.manage')
  @Put('workers/:id/calibration/safety/:rule')
  setSafety(
    @CurrentUser() caller: JwtUser,
    @Param('id') workerId: string,
    @Param('rule', new ParseEnumPipe(SafetyRule)) rule: SafetyRule,
    @Body() body: SafetyLimitDto,
  ) {
    return this.calibration.setSafety(caller, workerId, rule, body.values)
  }

  /** Remove a trava personalizada: vale o padrão do perfil. */
  @Can('monitoring.safety.manage')
  @Delete('workers/:id/calibration/safety/:rule')
  clearSafety(
    @CurrentUser() caller: JwtUser,
    @Param('id') workerId: string,
    @Param('rule', new ParseEnumPipe(SafetyRule)) rule: SafetyRule,
  ) {
    return this.calibration.clearSafety(caller, workerId, rule)
  }
}
