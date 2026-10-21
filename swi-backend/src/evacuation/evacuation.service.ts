import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { RouteProvider } from './evacuation.provider'
import { normalizeMusterPoint, type AreaVertex } from './evacuation-area'
import type { RouteSnapshot } from './evacuation.types'
import type { JwtUser } from '../auth/current-user.decorator'

// Caminhada de 1,2 m/s para estimar o tempo da linha reta, quando o roteador cai.
const WALK_MPS = 1.2

/** `from=lng,lat` da query; ausente é null, malformado é 400. */
export function parseFrom(raw: string | undefined): AreaVertex | null {
  if (raw === undefined || raw === '') return null
  const parts = raw.split(',').map((p) => Number(p.trim()))
  try {
    // Reaproveita a validação do ponto de encontro: mesmo par [lng, lat],
    // mesmos limites do globo. O `raw` entra quando não há dois campos, para
    // cair no inválido em vez de passar um array de tamanho errado.
    return normalizeMusterPoint(parts.length === 2 ? parts : raw)
  } catch {
    throw new BadRequestException('from precisa ser "lng,lat" dentro dos limites do globo')
  }
}

function metersBetween([lng1, lat1]: AreaVertex, [lng2, lat2]: AreaVertex): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLng = (lng2 - lng1) * rad
  const a =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) ** 2
  return 2 * 6371008.8 * Math.asin(Math.sqrt(a))
}

@Injectable()
export class EvacuationService {
  private readonly logger = new Logger(EvacuationService.name)

  constructor(
    private readonly provider: RouteProvider,
    private readonly prisma: PrismaService,
  ) {}

  // Da posição da pessoa até o ponto de encontro da evacuação ativa da empresa
  // dela. A posição vem do GPS do app (`from`); sem ela, a última posição real
  // que o app mandou. Prisma direto, e não PositionsService: o PositionsModule
  // já importa este módulo (o simulador), e o contrário faria um ciclo.
  async getRoute(user: JwtUser, from: AreaVertex | null): Promise<RouteSnapshot> {
    const evac = await this.prisma.evacuation.findFirst({
      where: { companyId: user.companyId, status: 'ACTIVE' },
      select: { musterPoint: true },
    })
    const destination = (evac?.musterPoint as AreaVertex | null | undefined) ?? null
    if (!destination) throw new NotFoundException('Sem evacuação ativa com ponto de encontro')

    let origin = from
    if (!origin) {
      const pos = await this.prisma.workerPosition.findFirst({
        where: { workerId: user.userId, source: 'real' },
        select: { lat: true, lng: true },
      })
      if (pos) origin = [pos.lng, pos.lat]
    }
    if (!origin) throw new ConflictException('Sem posição para traçar a rota')

    const fetchedAt = new Date().toISOString()
    try {
      const real = await this.provider.fetch({ origin, destination })
      return { ...real, origin, destination, approximate: false, fetchedAt }
    } catch (err) {
      // Tela de segurança nunca quebra, mas também não inventa caminho: linha
      // reta marcada como aproximada, e o app avisa.
      this.logger.warn(`roteador indisponível, servindo linha reta: ${String(err)}`)
      const distanceM = metersBetween(origin, destination)
      return {
        waypoints: [origin, destination],
        durationSec: Math.round(distanceM / WALK_MPS),
        distanceM,
        origin,
        destination,
        approximate: true,
        fetchedAt,
      }
    }
  }
}
