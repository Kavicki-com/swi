import { Module } from '@nestjs/common'
import { JwtModule } from '@nestjs/jwt'
import { RealtimeModule } from '../realtime/realtime.module'
import { LiveController } from './live.controller'
import { LiveGateway } from './live.gateway'
import { LiveRateLimit } from './live-rate-limit'
import { LiveRegistry } from './live-registry'
import { LiveService } from './live.service'

// Transmissão ao vivo da câmera do celular: sinalização no mesmo socket do
// RealtimeGateway e estado só em memória (um registro por processo).
@Module({
  imports: [JwtModule.register({}), RealtimeModule],
  controllers: [LiveController],
  providers: [
    { provide: LiveRegistry, useFactory: () => new LiveRegistry() },
    { provide: LiveRateLimit, useFactory: () => new LiveRateLimit() },
    LiveService,
    LiveGateway,
  ],
})
export class LiveModule {}
