import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@CurrentUserId() userId: string) { return this.notifications.list(userId) }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@CurrentUserId() userId: string) { return this.notifications.markAllRead(userId) }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@CurrentUserId() userId: string, @Param('id') id: string) { return this.notifications.markRead(userId, id) }
}
