import { Body, Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { AddTaskPhotoDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'

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
  startTask(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.journey.startTask(userId, id)
  }

  @Post('tasks/:id/complete')
  completeTask(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.journey.completeTask(userId, id)
  }

  @Post('tasks/:id/cancel')
  cancelTask(@CurrentUserId() userId: string, @Param('id') id: string) {
    return this.journey.cancelTask(userId, id)
  }

  @Post('pause')
  pause(@CurrentUserId() userId: string) {
    return this.journey.pauseJourney(userId)
  }

  @Post('resume')
  resume(@CurrentUserId() userId: string) {
    return this.journey.resumeJourney(userId)
  }

  @Post('end')
  end(@CurrentUserId() userId: string) {
    return this.journey.endJourney(userId)
  }

  @Post('tasks/:id/photo')
  addPhoto(@CurrentUserId() userId: string, @Param('id') id: string, @Body() dto: AddTaskPhotoDto) {
    return this.journey.addTaskPhoto(userId, id, dto.imageKey)
  }
}
