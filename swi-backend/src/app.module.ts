import { Module, ValidationPipe } from '@nestjs/common'
import { APP_GUARD, APP_PIPE } from '@nestjs/core'
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler'
import { PrismaModule } from './prisma/prisma.module'
import { AuthModule } from './auth/auth.module'
import { UsersModule } from './users/users.module'
import { ProfileModule } from './profile/profile.module'
import { MediaModule } from './media/media.module'
import { ReportsModule } from './reports/reports.module'
import { HealthController } from './health.controller'

@Module({
  imports: [
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 100 }]),
    PrismaModule, AuthModule, UsersModule, ProfileModule, MediaModule, ReportsModule,
  ],
  controllers: [HealthController],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_PIPE, useValue: new ValidationPipe({ whitelist: true, transform: true }) },
  ],
})
export class AppModule {}
