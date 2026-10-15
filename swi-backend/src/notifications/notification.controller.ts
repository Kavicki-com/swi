import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { NotificationService } from './notification.service'
import { PauseRequestDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Can } from '../auth/roles.decorator'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUserId() userId: string) { return this.notifications.list(userId) }

  // "Solicitar Pausa" real: ADMIN pede, o worker recebe a notificação.
  @UseGuards(JwtAuthGuard, RolesGuard) @Can('alerts.operate') @Post('pause-request') @HttpCode(204)
  pauseRequest(@CurrentUser() user: JwtUser, @Body() dto: PauseRequestDto) {
    return this.notifications.requestPause(dto.workerId, user.companyId)
  }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUserId() userId: string) { return this.notifications.markAllRead(userId) }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@CurrentUserId() userId: string, @Param('id') id: string) { return this.notifications.markRead(userId, id) }
}
