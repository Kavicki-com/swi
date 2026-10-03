import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationService } from '../notifications/notification.service'
import { WeatherService } from './weather.service'
import { locationOf } from './weather.types'
import type { WeatherAlert } from './weather.types'

/** Balde dos funcionários sem empresa: ficam no local padrão do serviço. */
export const NO_COMPANY_SCOPE = 'sem-empresa'

type Recipient = { id: string; companyId: string | null }

@Injectable()
export class WeatherAlertService {
  private readonly logger = new Logger(WeatherAlertService.name)

  constructor(
    private readonly weather: WeatherService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
  ) {}

  // Default 30min; override via WEATHER_CRON (|| pra tratar '' como ausente).
  @Cron(process.env.WEATHER_CRON || CronExpression.EVERY_30_MINUTES)
  async pollAndNotify(now = new Date()): Promise<void> {
    try {
      const workers: Recipient[] = await this.prisma.user.findMany({
        where: { role: 'WORKER', approvalStatus: 'APPROVED', active: true },
        select: { id: true, companyId: true },
      })
      await this.notifyDemo(workers, now)

      // Cada empresa no próprio local, avisando só a própria equipe.
      const byScope = new Map<string | null, string[]>()
      for (const w of workers) byScope.set(w.companyId, [...(byScope.get(w.companyId) ?? []), w.id])
      const companyIds = [...byScope.keys()].filter((id): id is string => id !== null)
      const companies = companyIds.length
        ? await this.prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, lat: true, lng: true } })
        : []
      const byId = new Map(companies.map((c) => [c.id, c]))

      for (const [companyId, ids] of byScope) {
        const scope = companyId ?? NO_COMPANY_SCOPE
        try {
          const alerts = await this.weather.alertsAt(locationOf(companyId ? byId.get(companyId) : null), now)
          for (const alert of alerts) await this.notifyOnce(scope, ids, alert)
        } catch (err) {
          // Uma empresa com falha não segura o aviso das outras.
          this.logger.warn(`clima→notif falhou em ${scope}: ${String(err)}`)
        }
      }
    } catch (err) {
      // best-effort: falha de poll nunca derruba o app, mas não silenciosa
      // (é o único ponto sem request/response pra superficializar o erro).
      this.logger.warn(`clima→notif falhou: ${String(err)}`)
    }
  }

  // Alerta real: o mesmo tipo cuja janela encosta numa já avisada é o mesmo
  // alerta, mesmo com outro id (a janela anda com o relógio). Nesse caso só a
  // janela avisada se estende, sem aviso novo.
  private async notifyOnce(scope: string, workerIds: string[], alert: WeatherAlert): Promise<void> {
    const endsAt = new Date(alert.endsAt)
    const seen = await this.prisma.weatherAlertSeen.findFirst({
      where: { scope, kind: alert.kind, endsAt: { gte: new Date(alert.startsAt) } },
      orderBy: { endsAt: 'desc' },
    })
    if (seen) {
      if (seen.endsAt && seen.endsAt < endsAt) {
        await this.prisma.weatherAlertSeen.update({ where: { alertId: seen.alertId }, data: { endsAt } })
      }
      return
    }
    await this.notifications.enqueueForMany(workerIds, {
      domain: 'weather',
      title: `Alerta Meteorológico: ${alert.event}`,
      body: alert.description,
      targetId: alert.id,
    })
    await this.prisma.weatherAlertSeen.create({
      data: { alertId: `${scope}:${alert.id}`, scope, kind: alert.kind, endsAt },
    })
  }

  // Alerta de demonstração (fora de produção): não tem local, vai para todos de
  // uma vez e se registra pelo id fixo, que o seed já marca como avisado.
  private async notifyDemo(workers: Recipient[], now: Date): Promise<void> {
    for (const alert of this.weather.demoAlerts(now)) {
      const seen = await this.prisma.weatherAlertSeen.findUnique({ where: { alertId: alert.id } })
      if (seen) continue
      await this.notifications.enqueueForMany(workers.map((w) => w.id), {
        domain: 'weather',
        title: 'Alerta Meteorológico',
        body: alert.description,
        targetId: alert.id,
      })
      await this.prisma.weatherAlertSeen.create({ data: { alertId: alert.id } })
    }
  }
}
