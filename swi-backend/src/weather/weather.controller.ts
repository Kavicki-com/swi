import { Controller, Get, UseGuards } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'

@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  get() {
    return this.weather.getSnapshot()
  }
}
