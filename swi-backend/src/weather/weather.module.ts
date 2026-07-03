import { Module } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { WeatherController } from './weather.controller'
import { OpenMeteoProvider } from './weather.provider'
import { WeatherAlertService } from './weather-alert.service'
import { NotificationModule } from '../notifications/notification.module'

@Module({
  imports: [NotificationModule],
  controllers: [WeatherController],
  providers: [WeatherService, OpenMeteoProvider, WeatherAlertService],
})
export class WeatherModule {}
