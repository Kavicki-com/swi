import { Injectable, Logger } from '@nestjs/common'
import { RouteProvider } from './evacuation.provider'
import { CANNED_ROUTE } from './evacuation.types'
import type { RouteSnapshot } from './evacuation.types'

@Injectable()
export class EvacuationService {
  private readonly logger = new Logger(EvacuationService.name)

  constructor(private readonly provider: RouteProvider) {}

  async getRoute(): Promise<RouteSnapshot> {
    const now = new Date()
    let waypoints = CANNED_ROUTE.waypoints, durationSec = CANNED_ROUTE.durationSec, distanceM = CANNED_ROUTE.distanceM
    try {
      const real = await this.provider.fetch()
      waypoints = real.waypoints; durationSec = real.durationSec; distanceM = real.distanceM
    } catch (err) {
      // fallback canned — tela de segurança nunca pode quebrar
      this.logger.warn(`roteador indisponível, servindo rota canned: ${String(err)}`)
    }
    return { waypoints, durationSec, distanceM, fetchedAt: now.toISOString() }
  }
}
