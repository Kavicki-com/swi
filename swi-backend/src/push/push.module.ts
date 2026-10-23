import { Module } from '@nestjs/common'
import { PushController } from './push.controller'
import { PUSH_TRANSPORT, PushService } from './push.service'
import { httpPostJson } from '../common/httpPost'

@Module({
  controllers: [PushController],
  providers: [PushService, { provide: PUSH_TRANSPORT, useValue: httpPostJson }],
  // Exportado para quem avisa o app fora do socket (hoje, a evacuação).
  exports: [PushService],
})
export class PushModule {}
