import { Module } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { WeatherController } from './weather.controller'
import { OpenMeteoProvider } from './weather.provider'

@Module({
  controllers: [WeatherController],
  providers: [WeatherService, OpenMeteoProvider],
})
export class WeatherModule {}
