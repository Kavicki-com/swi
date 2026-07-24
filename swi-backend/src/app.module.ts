import { Module, ValidationPipe } from '@nestjs/common'
import { APP_GUARD, APP_PIPE } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { ScheduleModule } from '@nestjs/schedule'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ProfileModule } from './profile/profile.module'
import { MediaModule } from './media/media.module'
import { ReportsModule } from './reports/reports.module'
import { JourneyModule } from './journey/journey.module'
import { WorkOrdersModule } from './work-orders/work-orders.module'
import { ChatModule } from './chat/chat.module'
import { RealtimeModule } from './realtime/realtime.module'
import { NotificationModule } from './notifications/notification.module'
import { WeatherModule } from './weather/weather.module'
import { EvacuationModule } from './evacuation/evacuation.module'
import { QueueModule } from './queue/queue.module'
import { SupportModule } from './support/support.module'
import { HealthController } from './health.controller'

@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 100 }],
      skipIf: () => process.env.NODE_ENV === 'test',
    }),
    PrismaModule, AuthModule, UsersModule, ProfileModule, MediaModule, ReportsModule, JourneyModule, WorkOrdersModule, ChatModule, RealtimeModule, NotificationModule, WeatherModule, EvacuationModule, QueueModule, SupportModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
  ],
})
export class AppModule {}
