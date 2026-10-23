import { Body, Controller, Delete, HttpCode, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { PushService } from './push.service'
import { RegisterPushTokenDto, RemovePushTokenDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { CurrentUserId } from '../auth/current-user.decorator'

// Aparelho do app que recebe push. Sem @Roles de propósito: todo papel que
// entra no app (funcionário, supervisor, administrador) registra o próprio
// aparelho, e o dono vem sempre do JWT. O RolesGuard fica para que um papel
// declarado depois passe a valer sem mexer na classe.
@ApiTags('push')
@ApiBearerAuth()
@Controller('push')
@UseGuards(JwtAuthGuard, RolesGuard)
export class PushController {
  constructor(private readonly push: PushService) {}

  @Post('tokens')
  @HttpCode(204)
  register(@CurrentUserId() userId: string, @Body() dto: RegisterPushTokenDto) {
    return this.push.register(userId, dto.token, dto.platform)
  }

  // Token no corpo, não no caminho: fica fora do log de acesso do proxy.
  @Delete('tokens')
  @HttpCode(204)
  remove(@CurrentUserId() userId: string, @Body() dto: RemovePushTokenDto) {
    return this.push.unregister(userId, dto.token)
  }
}
