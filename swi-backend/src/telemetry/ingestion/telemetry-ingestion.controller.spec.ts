import type { DeviceIdentity } from '../devices/device-auth.service'
import { TelemetryIngestionController } from './telemetry-ingestion.controller'
import type { TelemetryIngestionService } from './telemetry-ingestion.service'

// O roteamento é assunto do e2e. O que se prova aqui é que o controlador não
// inventa identidade: passa adiante o aparelho da credencial e o lote do corpo.

const DEVICE: DeviceIdentity = { deviceId: 'device-1', workerId: 'worker-1' }

describe('TelemetryIngestionController', () => {
  it('ingere com o aparelho da credencial e o lote do corpo', async () => {
    const ingestion = { ingest: jest.fn().mockResolvedValue({ acceptedEventIds: [] }) }
    const batch = { events: [] }

    await new TelemetryIngestionController(
      ingestion as unknown as TelemetryIngestionService,
    ).ingest(DEVICE, batch)

    expect(ingestion.ingest).toHaveBeenCalledWith(DEVICE, batch)
  })
})
