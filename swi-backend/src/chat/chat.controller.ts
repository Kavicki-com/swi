import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { ChatService } from './chat.service'
import { SendMessageDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  listConversations(@CurrentUserId() userId: string) { return this.chat.listConversations(userId) }

  @Get('directory')
  listDirectory(@CurrentUser() user: JwtUser) { return this.chat.listDirectory(user.userId, user.companyId) }

  @Get('conversations/:id/messages')
  listMessages(@CurrentUserId() userId: string, @Param('id') id: string) { return this.chat.listMessages(userId, id) }

  @Post('conversations/:id/messages')
  send(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: SendMessageDto) {
    if (!dto.body?.trim() && !dto.imageKey) throw new BadRequestException('Mensagem vazia')
    return this.chat.sendMessage(userId, id, dto)
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  markRead(@CurrentUserId() userId: string, @Param('id') id: string) { return this.chat.markRead(userId, id) }
}
