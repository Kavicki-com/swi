import { Controller, Get, UseGuards } from '@nestjs/common'
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger'
import { EvacuationService } from './evacuation.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@ApiTags('evacuation')
@ApiBearerAuth()
@Controller('evacuation')
@UseGuards(JwtAuthGuard)
export class EvacuationController {
  constructor(private readonly evacuation: EvacuationService) {}

  @Get('route')
  getRoute() {
    return this.evacuation.getRoute()
  }
}
