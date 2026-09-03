import { Body, Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentUser, CurrentUserId, type JwtUser } from '../../auth/current-user.decorator'
import { JwtAuthGuard } from '../../auth/jwt-auth.guard'
import { Roles } from '../../auth/roles.decorator'
import { RolesGuard } from '../../auth/roles.guard'
import { DeviceAuthService } from './device-auth.service'
import { CompleteEnrollmentDto } from './dto/complete-enrollment.dto'
import { CreateEnrollmentDto } from './dto/create-enrollment.dto'

// Pareamento de aparelho do piloto. O administrador convida; o funcionário
// conclui no próprio iPhone, autenticado como ele mesmo. As duas rotas de
// enrollment têm teto de taxa próprio: o teto global de 100 por minuto seria
// generoso demais para quem estivesse adivinhando um código de seis dígitos.
@Controller('telemetry/v1/devices')
@UseGuards(JwtAuthGuard, RolesGuard)
export class TelemetryDevicesController {
  constructor(private readonly devices: DeviceAuthService) {}

  @Roles('ADMIN')
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('enrollments')
  createEnrollment(@CurrentUser() admin: JwtUser, @Body() dto: CreateEnrollmentDto) {
    return this.devices.createEnrollment(admin, dto)
  }

  // Sem @Roles de propósito: quem conclui é o funcionário dono do enrollment, e
  // o RolesGuard libera a rota que não declara papel. O serviço confere que o
  // pareamento é dele, então o id do token é a autoridade.
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  @Post('enrollments/complete')
  @HttpCode(200)
  complete(@CurrentUserId() workerId: string, @Body() dto: CompleteEnrollmentDto) {
    return this.devices.completeEnrollment(workerId, dto)
  }

  @Roles('ADMIN')
  @Post(':id/revoke')
  @HttpCode(204)
  revoke(@CurrentUser() admin: JwtUser, @Param('id') deviceId: string) {
    return this.devices.revoke(admin, deviceId)
  }
}
