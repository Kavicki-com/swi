import { Controller, Get, UseGuards } from '@nestjs/common'
import { EvacuationService } from './evacuation.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('evacuation')
@UseGuards(JwtAuthGuard)
export class EvacuationController {
  constructor(private readonly evacuation: EvacuationService) {}

  @Get('route')
  getRoute() {
    return this.evacuation.getRoute()
  }
}
