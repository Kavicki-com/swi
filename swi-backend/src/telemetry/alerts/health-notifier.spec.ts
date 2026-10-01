import type { NotificationService } from '../../notifications/notification.service'
import type { TelemetryAudienceService } from '../realtime/telemetry-audience.service'
import type { ConditionChange } from './condition.service'
import { healthNotificationsFor, TelemetryHealthNotifier } from './health-notifier'

const AT = '2026-10-01T15:00:00.000Z'

const change = (over: Partial<ConditionChange> = {}): ConditionChange => ({
  workerId: 'worker-1',
  conditionId: 'cond-1',
  kind: 'HEART_RATE_HIGH',
  change: 'OPENED',
  at: AT,
  ...over,
})

const row = (over: Record<string, unknown> = {}) => ({
  id: 'cond-1',
  workerId: 'worker-1',
  origin: 'REAL',
  kind: 'HEART_RATE_HIGH',
  observedValue: 185,
  thresholdValue: 167,
  worker: { name: 'Ana Souza' },
  ...over,
})

const prismaDouble = (rows: ReturnType<typeof row>[] = [row()], notified: { targetId: string }[] = []) => ({
  telemetryCondition: { findMany: jest.fn().mockResolvedValue(rows) },
  notification: { findMany: jest.fn().mockResolvedValue(notified) },
})

const notificationsDouble = () => ({ enqueueForMany: jest.fn().mockResolvedValue(undefined) })

const audienceDouble = (recipients = ['worker-1', 'admin-1', 'admin-2']) => ({
  recipientsFor: jest.fn().mockResolvedValue(recipients),
})

const notifier = (
  prisma = prismaDouble(),
  notifications = notificationsDouble(),
  audience = audienceDouble(),
) =>
  new TelemetryHealthNotifier(
    prisma as never,
    notifications as unknown as NotificationService,
    audience as unknown as TelemetryAudienceService,
  )

describe('healthNotificationsFor', () => {
  it('batimento alto vai ao funcionário e aos administradores, com o nome para os administradores', () => {
    const out = healthNotificationsFor({ kind: 'HEART_RATE_HIGH', observedValue: 185.4, thresholdValue: 167 }, 'Ana Souza')
    expect(out.worker).toEqual({ domain: 'health', title: 'Batimento acima do limite', body: 'Seu batimento chegou a 185 bpm, acima do limite de 167 bpm.' })
    expect(out.admins).toEqual({ domain: 'health', title: 'Batimento alto: Ana Souza', body: '185 bpm, acima do limite de 167 bpm.' })
  })

  it('batimento baixo segue a mesma rota', () => {
    const out = healthNotificationsFor({ kind: 'HEART_RATE_LOW', observedValue: 38, thresholdValue: 40 }, 'Ana Souza')
    expect(out.worker?.title).toBe('Batimento abaixo do limite')
    expect(out.admins?.title).toBe('Batimento baixo: Ana Souza')
  })

  it('desgaste alto vai aos dois, sem valor inventado quando não há leitura', () => {
    const out = healthNotificationsFor({ kind: 'WEAR_HIGH', observedValue: 82.2, thresholdValue: 80 }, 'Ana Souza')
    expect(out.worker).toEqual({ domain: 'health', title: 'Desgaste alto', body: 'Desgaste estimado em 82%. Considere uma pausa.' })
    expect(out.admins).toEqual({ domain: 'health', title: 'Desgaste alto: Ana Souza', body: 'Desgaste estimado em 82%.' })
    expect(healthNotificationsFor({ kind: 'WEAR_HIGH', observedValue: null, thresholdValue: 80 }, 'Ana').worker?.body).toBe('Considere uma pausa.')
  })

  it('pressão para revisar vai aos dois e não repete o valor', () => {
    const out = healthNotificationsFor({ kind: 'BLOOD_PRESSURE_REVIEW', observedValue: 162, thresholdValue: 160 }, 'Ana Souza')
    expect(out.worker?.title).toBe('Pressão para revisar')
    expect(out.admins?.title).toBe('Pressão para revisar: Ana Souza')
    expect(out.worker?.body).not.toContain('162')
  })

  // Quem resolve bateria fraca é quem está com o relógio.
  it('bateria fraca vai só ao funcionário', () => {
    const out = healthNotificationsFor({ kind: 'DEVICE_BATTERY_LOW', observedValue: 12, thresholdValue: 15 }, 'Ana Souza')
    expect(out.worker).toEqual({ domain: 'health', title: 'Bateria do relógio baixa', body: 'Bateria em 12%. Carregue o relógio para seguir monitorado.' })
    expect(out.admins).toBeNull()
  })

  // Sem sinal o aparelho do funcionário provavelmente nem recebe; quem precisa
  // saber que alguém saiu do monitoramento é a administração.
  it('perda de sinal vai só aos administradores', () => {
    const out = healthNotificationsFor({ kind: 'DEVICE_SIGNAL_LOST', observedValue: 600000, thresholdValue: 600000 }, 'Ana Souza')
    expect(out.worker).toBeNull()
    expect(out.admins).toEqual({ domain: 'health', title: 'Sem sinal do relógio: Ana Souza', body: 'O monitoramento parou de receber dados.' })
  })
})

describe('TelemetryHealthNotifier', () => {
  it('condição aberta de origem real notifica o funcionário e os administradores, com a condição como alvo', async () => {
    const notifications = notificationsDouble()
    await notifier(prismaDouble(), notifications).notifyOpened([change()])
    expect(notifications.enqueueForMany).toHaveBeenCalledWith(['worker-1'], expect.objectContaining({ title: 'Batimento acima do limite', targetId: 'cond-1' }))
    expect(notifications.enqueueForMany).toHaveBeenCalledWith(['admin-1', 'admin-2'], expect.objectContaining({ title: 'Batimento alto: Ana Souza', targetId: 'cond-1' }))
  })

  it('recuperação não notifica: o feed só recebe o que pede atenção', async () => {
    const prisma = prismaDouble()
    const notifications = notificationsDouble()
    await notifier(prisma, notifications).notifyOpened([change({ change: 'RECOVERED' })])
    expect(prisma.telemetryCondition.findMany).not.toHaveBeenCalled()
    expect(notifications.enqueueForMany).not.toHaveBeenCalled()
  })

  it('demonstração não notifica ninguém', async () => {
    const notifications = notificationsDouble()
    await notifier(prismaDouble([row({ origin: 'DEMO' })]), notifications).notifyOpened([change()])
    expect(notifications.enqueueForMany).not.toHaveBeenCalled()
  })

  it('a mesma condição nunca notifica duas vezes', async () => {
    const notifications = notificationsDouble()
    await notifier(prismaDouble([row()], [{ targetId: 'cond-1' }]), notifications).notifyOpened([change()])
    expect(notifications.enqueueForMany).not.toHaveBeenCalled()
  })

  it('funcionário sem empresa: só ele, sem lista vazia de administradores enfileirada', async () => {
    const notifications = notificationsDouble()
    await notifier(prismaDouble(), notifications, audienceDouble(['worker-1'])).notifyOpened([change()])
    expect(notifications.enqueueForMany).toHaveBeenCalledTimes(1)
    expect(notifications.enqueueForMany).toHaveBeenCalledWith(['worker-1'], expect.anything())
  })

  it('falha de uma condição não impede as outras e nunca levanta', async () => {
    const notifications = notificationsDouble()
    notifications.enqueueForMany.mockRejectedValueOnce(new Error('fila fora')).mockResolvedValue(undefined)
    const prisma = prismaDouble([row(), row({ id: 'cond-2', workerId: 'worker-2', kind: 'DEVICE_BATTERY_LOW', observedValue: 10 })])
    await expect(
      notifier(prisma, notifications, audienceDouble(['worker-1'])).notifyOpened([change(), change({ conditionId: 'cond-2', workerId: 'worker-2', kind: 'DEVICE_BATTERY_LOW' })]),
    ).resolves.toBeUndefined()
    expect(notifications.enqueueForMany).toHaveBeenCalledWith(['worker-2'], expect.objectContaining({ title: 'Bateria do relógio baixa' }))
  })

  it('falha ao ler as condições nunca levanta', async () => {
    const prisma = prismaDouble()
    prisma.telemetryCondition.findMany.mockRejectedValue(new Error('banco fora'))
    await expect(notifier(prisma).notifyOpened([change()])).resolves.toBeUndefined()
  })
})
