import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common'
import { Throttle } from '@nestjs/throttler'
import { CurrentDevice } from '../devices/current-device.decorator'
import { DeviceAuthGuard } from '../devices/device-auth.guard'
import type { DeviceIdentity } from '../devices/device-auth.service'
import { TelemetryBatchDto } from './dto/telemetry-batch.dto'
import { TelemetryIngestionService } from './telemetry-ingestion.service'

// Rota que o aparelho chama sozinho, sem JWT de pessoa: o DeviceAuthGuard troca
// a credencial do pareamento por identidade verificada, e é dela que saem o
// funcionário e o dispositivo de cada evento.
@Controller('telemetry/v1')
@UseGuards(DeviceAuthGuard)
export class TelemetryIngestionController {
  constructor(private readonly ingestion: TelemetryIngestionService) {}

  /**
   * 200 e não 201: a resposta não é "criei um recurso", é o ACK por evento, com
   * aceitos, repetidos e recusados. Repetir o mesmo lote devolve o mesmo ACK.
   *
   * Teto próprio bem acima do global de 100 por minuto: o caminho conectado é
   * uma chamada por medição, e vários aparelhos de uma obra saem pelo mesmo IP,
   * que é como o throttler conta. Com o teto global, um turno normal seria
   * cortado como se fosse abuso.
   */
  @Throttle({ default: { limit: 600, ttl: 60000 } })
  @Post('batches')
  @HttpCode(200)
  ingest(@CurrentDevice() device: DeviceIdentity, @Body() batch: TelemetryBatchDto) {
    return this.ingestion.ingest(device, batch)
  }
}
