import { Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { NotificationService } from './notification.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('notifications')
@UseGuards(JwtAuthGuard)
export class NotificationController {
  constructor(private readonly notifications: NotificationService) {}

  @Get()
  list(@Req() req: any) { return this.notifications.list(req.user.userId) }

  @Post('read-all')
  @HttpCode(204)
  markAllRead(@Req() req: any) { return this.notifications.markAllRead(req.user.userId) }

  @Post(':id/read')
  @HttpCode(204)
  markRead(@Req() req: any, @Param('id') id: string) { return this.notifications.markRead(req.user.userId, id) }
}
