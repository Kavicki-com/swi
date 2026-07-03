import { BadRequestException, Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards } from '@nestjs/common'
import { ChatService } from './chat.service'
import { SendMessageDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  listConversations(@Req() req: any) { return this.chat.listConversations(req.user.userId) }

  @Get('directory')
  listDirectory(@Req() req: any) { return this.chat.listDirectory(req.user.userId) }

  @Get('conversations/:id/messages')
  listMessages(@Req() req: any, @Param('id') id: string) { return this.chat.listMessages(req.user.userId, id) }

  @Post('conversations/:id/messages')
  send(@Req() req: any, @Param('id') id: string, @Body() dto: SendMessageDto) {
    if (!dto.body?.trim() && !dto.imageKey) throw new BadRequestException('Mensagem vazia')
    return this.chat.sendMessage(req.user.userId, id, dto)
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  markRead(@Req() req: any, @Param('id') id: string) { return this.chat.markRead(req.user.userId, id) }
}
