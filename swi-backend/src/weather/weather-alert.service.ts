import { Injectable, Logger } from '@nestjs/common'
import { Cron, CronExpression } from '@nestjs/schedule'
import { PrismaService } from '../prisma/prisma.service'
import { NotificationService } from '../notifications/notification.service'
import { WeatherService } from './weather.service'

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
  async pollAndNotify(): Promise<void> {
    try {
      const snap = await this.weather.getSnapshot()
      for (const alert of snap.alerts) {
        const seen = await this.prisma.weatherAlertSeen.findUnique({ where: { alertId: alert.id } })
        if (seen) continue
        // O conjunto de destinatários é idêntico entre alertas de um mesmo tick;
        // se uma fonte multi-alerta real for ligada, hoistar acima do loop.
        // Hoje 0-1 alertas/tick, então buscar dentro do loop é irrelevante.
        const workers = await this.prisma.user.findMany({
          where: { role: 'WORKER', approvalStatus: 'APPROVED' },
          select: { id: true },
        })
        await this.notifications.enqueueForMany(workers.map((w) => w.id), {
          domain: 'weather',
          title: 'Alerta Meteorológico',
          body: alert.description,
          targetId: alert.id,
        })
        await this.prisma.weatherAlertSeen.create({ data: { alertId: alert.id } })
      }
    } catch (err) {
      // best-effort: falha de poll nunca derruba o app — mas não silenciosa
      // (é o único ponto sem request/response pra superficializar o erro).
      this.logger.warn(`clima→notif falhou: ${err}`)
    }
  }
}
