import { Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { IsString, MinLength } from 'class-validator'
import { NotificationService } from './notification.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

// QA F (2026-07-24): payload do "Solicitar Pausa" do detalhe do funcionário.
export class PauseRequestDto { @IsString() @MinLength(1) workerId!: string }

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUserId() userId: string) { return this.notifications.list(userId) }

  // "Solicitar Pausa" real: ADMIN pede, o worker recebe a notificação.
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post('pause-request') @HttpCode(204)
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
