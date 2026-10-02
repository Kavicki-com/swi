import { Injectable, Logger } from '@nestjs/common'
import { PrismaService } from '../../prisma/prisma.service'

/**
 * Prazo do cache de destinatários. Curto de propósito: administrador recém
 * cadastrado ou desativado passa a receber, ou deixa de receber, em até este
 * tempo. O aviso só carrega identificadores, e o valor continua vindo pelo read
 * model, que confere o acesso a cada leitura; um cache vencido atrasa um aviso,
 * mas não entrega dado a ninguém.
 */
export const AUDIENCE_CACHE_TTL_MS = 30_000

interface Cached<T> {
  value: T
  expiresAt: number
}

/**
 * Quem recebe o aviso de telemetria de um funcionário: ele mesmo e os
 * administradores ativos da empresa dele. Sem empresa, só ele, que é a mesma
 * regra do read model: administrador sem empresa não lê telemetria de ninguém.
 *
 * O aviso sai a cada lote ao vivo e a cada condição que muda, então a resposta
 * fica em cache por funcionário e por empresa, em vez de duas consultas por
 * evento.
 */
@Injectable()
export class TelemetryAudienceService {
  private readonly logger = new Logger(TelemetryAudienceService.name)
  private readonly companyByWorker = new Map<string, Cached<string | null>>()
  private readonly adminsByCompany = new Map<string, Cached<string[]>>()

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Nunca levanta: o aviso é posterior à escrita, e uma falha aqui recua para
   * só o funcionário, que continua recebendo o próprio aviso.
   */
  async recipientsFor(workerId: string): Promise<string[]> {
    try {
      const companyId = await this.companyOf(workerId)
      if (companyId === null) return [workerId]
      const admins = await this.adminsOf(companyId)
      return [workerId, ...admins.filter((id) => id !== workerId)]
    } catch (error) {
      this.logger.warn(`Falha ao resolver destinatários da telemetria: ${(error as Error).message}`)
      return [workerId]
    }
  }

  private async companyOf(workerId: string): Promise<string | null> {
    const hit = this.fresh(this.companyByWorker.get(workerId))
    if (hit !== undefined) return hit
    const worker = await this.prisma.user.findUnique({ where: { id: workerId }, select: { companyId: true } })
    const companyId = worker?.companyId ?? null
    this.companyByWorker.set(workerId, { value: companyId, expiresAt: Date.now() + AUDIENCE_CACHE_TTL_MS })
    return companyId
  }

  private async adminsOf(companyId: string): Promise<string[]> {
    const hit = this.fresh(this.adminsByCompany.get(companyId))
    if (hit !== undefined) return hit
    const rows = await this.prisma.user.findMany({
      where: { role: 'ADMIN', companyId, active: true },
      select: { id: true },
    })
    const ids = rows.map((row) => row.id)
    this.adminsByCompany.set(companyId, { value: ids, expiresAt: Date.now() + AUDIENCE_CACHE_TTL_MS })
    return ids
  }

  private fresh<T>(entry: Cached<T> | undefined): T | undefined {
    return entry !== undefined && entry.expiresAt > Date.now() ? entry.value : undefined
  }
}
