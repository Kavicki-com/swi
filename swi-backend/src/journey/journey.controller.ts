import { Body, Controller, Get, NotFoundException, Param, Post, Req, UseGuards } from '@nestjs/common'
import { JourneyService } from './journey.service'
import { AddTaskPhotoDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('journey')
@UseGuards(JwtAuthGuard)
export class JourneyController {
  constructor(private readonly journey: JourneyService) {}

  @Get()
  getJourney(@Req() req: any) {
    return this.journey.getJourney(req.user.userId)
  }

  @Get('tasks')
  listTasks(@Req() req: any) {
    return this.journey.listTasks(req.user.userId)
  }

  @Get('tasks/:id')
  async getTask(@Req() req: any, @Param('id') id: string) {
    const t = await this.journey.getTask(req.user.userId, id)
    if (!t) throw new NotFoundException('Tarefa não encontrada')
    return t
  }

  @Post('tasks/:id/start')
  startTask(@Req() req: any, @Param('id') id: string) {
    return this.journey.startTask(req.user.userId, id)
  }

  @Post('pause')
  pause(@Req() req: any) {
    return this.journey.pauseJourney(req.user.userId)
  }

  @Post('resume')
  resume(@Req() req: any) {
    return this.journey.resumeJourney(req.user.userId)
  }

  @Post('end')
  end(@Req() req: any) {
    return this.journey.endJourney(req.user.userId)
  }

  @Post('tasks/:id/photo')
  addPhoto(@Req() req: any, @Param('id') id: string, @Body() dto: AddTaskPhotoDto) {
    return this.journey.addTaskPhoto(req.user.userId, id, dto.imageKey)
  }
}
