import { Body, Controller, Get, Headers, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { JourneyService, type JourneySend } from './journey.service'
import { AddTaskPhotoDto, JourneyActionDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'
import { parseIdempotencyKey } from '../idempotency/idempotency-key'

// O que a fila offline do app manda junto de cada ação, tudo opcional:
// `Idempotency-Key` (o reenvio não repete a ação), `occurredAt` no corpo (a
// hora do toque) e `X-Sent-At` (a hora do envio, nova a cada tentativa). Sem
// eles a ação vale na hora em que chega, como sempre.
function sendOf(dto: JourneyActionDto | undefined, rawKey: string | undefined, sentAt: string | undefined): JourneySend {
  return { key: parseIdempotencyKey(rawKey), occurredAt: dto?.occurredAt, sentAt }
}

@Controller('journey')
@UseGuards(JwtAuthGuard)
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get()
  getJourney(@CurrentUserId() userId: string) {
    return this.journey.getJourney(userId)
  }

  @Get('tasks')
  listTasks(@CurrentUserId() userId: string) {
    return this.journey.listTasks(userId)
  }

  @Get('tasks/:id')
  async getTask(@CurrentUserId() userId: string, @Param('id') id: string) {
    const t = await this.journey.getTask(userId, id)
    if (!t) throw new NotFoundException('Tarefa não encontrada')
    return t
  }

  @Post('tasks/:id/start')
  startTask(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.startTask(userId, id, sendOf(dto, rawKey, sentAt))
  }

  @Post('tasks/:id/complete')
  completeTask(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.completeTask(userId, id, sendOf(dto, rawKey, sentAt))
  }

  @Post('tasks/:id/cancel')
  cancelTask(
    @CurrentUserId() userId: string,
    @Param('id') id: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.cancelTask(userId, id, sendOf(dto, rawKey, sentAt))
  }

  @Post('pause')
  pause(
    @CurrentUserId() userId: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.pauseJourney(userId, sendOf(dto, rawKey, sentAt))
  }

  @Post('resume')
  resume(
    @CurrentUserId() userId: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.resumeJourney(userId, sendOf(dto, rawKey, sentAt))
  }

  @Post('end')
  end(
    @CurrentUserId() userId: string,
    @Body() dto: JourneyActionDto,
    @Headers('idempotency-key') rawKey?: string,
    @Headers('x-sent-at') sentAt?: string,
  ) {
    return this.journey.endJourney(userId, sendOf(dto, rawKey, sentAt))
  }

  @Post('tasks/:id/photo')
  addPhoto(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: AddTaskPhotoDto) {
    return this.journey.addTaskPhoto(userId, id, dto.imageKey)
  }
}
