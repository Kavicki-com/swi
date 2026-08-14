import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { ChatService } from './chat.service'
import { EditMessageDto, ReportMessageDto, SendMessageDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUser, CurrentUserId, type JwtUser } from '../auth/current-user.decorator'

@Controller('chat')
@UseGuards(JwtAuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('conversations')
  listConversations(@CurrentUserId() userId: string) { return this.chat.listConversations(userId) }

  @Get('directory')
  listDirectory(@CurrentUser() user: JwtUser) { return this.chat.listDirectory(user.userId) }

  @Get('conversations/:id/messages')
  listMessages(@CurrentUserId() userId: string, @Param('id') id: string) { return this.chat.listMessages(userId, id) }

  @Post('conversations/:id/messages')
  send(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: SendMessageDto) {
    if (!dto.body?.trim() && !dto.imageKey) throw new BadRequestException('Mensagem vazia')
    return this.chat.sendMessage(userId, id, dto)
  }

  // Editar e excluir mensagem. Só o autor, e exclusão deixa marca.
  //
  // Os dois devolvem a mensagem no estado novo, em vez de 204: o cliente aplica
  // o retorno na hora, sem depender de o socket chegar, e o mesmo payload serve
  // pro echo em tempo real.
  @Patch('conversations/:id/messages/:messageId')
  edit(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: EditMessageDto,
  ) {
    return this.chat.editMessage(userId, id, messageId, dto)
  }

  @Delete('conversations/:id/messages/:messageId')
  remove(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
  ) {
    return this.chat.deleteMessage(userId, id, messageId)
  }

  @Post('conversations/:id/read')
  @HttpCode(204)
  markRead(@CurrentUserId() userId: string, @Param('id') id: string) { return this.chat.markRead(userId, id) }

  // Denunciar mensagem de outra pessoa. Aninhada na conversa como toda
  // operação de mensagem, porque a autorização parte da membership. Throttle
  // próprio porque cada chamada dispara e-mail, na mesma dose do /support.
  @Post('conversations/:id/messages/:messageId/report')
  @HttpCode(204)
  @Throttle({ default: { limit: 5, ttl: 60000 } })
  report(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReportMessageDto,
  ) {
    return this.chat.reportMessage(userId, id, messageId, dto)
  }
}
