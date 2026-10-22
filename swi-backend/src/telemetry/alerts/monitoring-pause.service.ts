import { Injectable, NotFoundException } from '@nestjs/common'
import type { JwtUser } from '../../auth/current-user.decorator'
import { PrismaService } from '../../prisma/prisma.service'

/** Estado da pausa dos alertas de um funcionário, como o painel o lê. */
export interface MonitoringPauseState {
  workerId: string
  /** ISO-8601 de quando a pausa começou; nulo quando os alertas estão ligados. */
  monitoringPausedAt: string | null
}

// Pausa dos alertas de um funcionário pelo painel (férias, afastamento). A
// regra mora no motor de condições: com a pausa ligada, nenhuma condição nova
// nasce para ele. Aqui só se liga e desliga, e as duas escritas são
// idempotentes: pausar quem já está pausado mantém o instante original, e
// retomar quem não está pausado não muda nada.
@Injectable()
export class MonitoringPauseService {
  constructor(private readonly prisma: PrismaService) {}

  async pause(caller: JwtUser, workerId: string, now = new Date()): Promise<MonitoringPauseState> {
    await this.requireWorker(caller, workerId)
    await this.prisma.user.updateMany({
      where: { id: workerId, monitoringPausedAt: null },
      data: { monitoringPausedAt: now },
    })
    return this.state(workerId)
  }

  async resume(caller: JwtUser, workerId: string): Promise<MonitoringPauseState> {
    await this.requireWorker(caller, workerId)
    await this.prisma.user.updateMany({
      where: { id: workerId, monitoringPausedAt: { not: null } },
      data: { monitoringPausedAt: null },
    })
    return this.state(workerId)
  }

  private async state(workerId: string): Promise<MonitoringPauseState> {
    const user = await this.prisma.user.findUnique({ where: { id: workerId }, select: { monitoringPausedAt: true } })
    return { workerId, monitoringPausedAt: user?.monitoringPausedAt?.toISOString() ?? null }
  }

  /**
   * Só funcionário da mesma empresa. Inexistente, de outra empresa, quem chama
   * sem empresa e id que não é de funcionário respondem o mesmo 404, para não
   * revelar quem existe.
   */
  private async requireWorker(caller: JwtUser, workerId: string): Promise<void> {
    const user =
      caller.companyId === null
        ? null
        : await this.prisma.user.findUnique({ where: { id: workerId }, select: { companyId: true, role: true } })
    if (user === null || user.companyId !== caller.companyId || user.role !== 'WORKER') {
      throw new NotFoundException('Funcionário não encontrado')
    }
  }
}
