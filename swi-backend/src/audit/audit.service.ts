import { ForbiddenException, Injectable, Logger } from '@nestjs/common'
import type { AuditAction, AuditEvent, Prisma } from '@prisma/client'
import type { JwtUser } from '../auth/current-user.decorator'
import { describeError } from '../common/describe-error'
import { PrismaService } from '../prisma/prisma.service'
import { auditActionLabel, isReadAction } from './audit-actions'
import type { AuditMetadata, AuditResolvableResource } from './audit.decorator'

// Trilha de auditoria: grava quem do painel leu ou alterou os dados de uma
// pessoa e devolve a trilha da empresa a quem pode lê-la.
//
// A gravação acontece depois da resposta e nunca a derruba: se o banco recusar
// a linha, o erro vai para o log descrito sem o dado (describeError) e a
// requisição já terminou como terminaria sem trilha. Nada do que foi lido nem
// do corpo enviado entra na linha; o corpo só é consultado para achar o id da
// pessoa quando a rota o recebe ali.

/** Leitura repetida pela mesma pessoa, sobre o mesmo alvo e com a mesma ação, dentro disto, não grava outra linha. */
export const READ_DEDUPE_WINDOW_MS = 5 * 60 * 1000

export const AUDIT_EVENTS_DEFAULT_LIMIT = 50
export const AUDIT_EVENTS_MAX_LIMIT = 100

export const USER_AGENT_MAX_LENGTH = 256
/** Id vindo de fora (caminho, corpo) é cortado aqui: a trilha não guarda texto arbitrário. */
export const ID_MAX_LENGTH = 128

/** O que o AuditGuard sabe da requisição quando a resposta termina. */
export interface AuditRequestFacts {
  meta: AuditMetadata
  actor: JwtUser
  params: Record<string, string | undefined>
  body: unknown
  /** Campos da resposta que o AuditInterceptor guardou (só ids). */
  captured: Record<string, string>
  method: string
  route: string
  status: number
  ip: string | null
  userAgent: string | null
}

export interface AuditEventItem {
  id: string
  createdAt: string
  action: AuditAction
  actionLabel: string
  actorId: string
  actorRole: string
  subjectUserId: string | null
  resourceType: string | null
  resourceId: string | null
  method: string
  route: string
  status: number
  ip: string | null
  userAgent: string | null
}

export interface AuditEventPage {
  items: AuditEventItem[]
  /** Id do último item; null quando não há próxima página. */
  nextCursor: string | null
}

export interface AuditEventQuery {
  subjectUserId?: string
  actorId?: string
  action?: AuditAction
  from?: string
  to?: string
  limit?: number
  cursor?: string
}

interface Located {
  subjectUserId: string | null
  resourceType: string | null
  resourceId: string | null
}

/** Chave da deduplicação de leitura; também é a da trava que serializa duas leituras juntas. */
const dedupeKey = (actorId: string, subjectUserId: string | null, action: AuditAction): string =>
  `audit:${actorId}:${subjectUserId ?? ''}:${action}`

const clip = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length > 0 ? value.slice(0, max) : null

function toItem(row: AuditEvent): AuditEventItem {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
    action: row.action,
    actionLabel: auditActionLabel(row.action),
    actorId: row.actorId,
    actorRole: row.actorRole,
    subjectUserId: row.subjectUserId,
    resourceType: row.resourceType,
    resourceId: row.resourceId,
    method: row.method,
    route: row.route,
    status: row.status,
    ip: row.ip,
    userAgent: row.userAgent,
  }
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name)
  private readonly pending = new Set<Promise<void>>()

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Grava a linha da requisição que terminou. Nunca rejeita: quem chama está
   * fora do ciclo da requisição, e uma rejeição solta derrubaria o processo.
   */
  recordRequest(facts: AuditRequestFacts, now = new Date()): Promise<void> {
    const write = this.write(facts, now).finally(() => this.pending.delete(write))
    this.pending.add(write)
    return write
  }

  /** Espera as gravações em andamento. O e2e usa para não depender de tempo. */
  async settled(): Promise<void> {
    await Promise.all([...this.pending])
  }

  private async write(facts: AuditRequestFacts, now: Date): Promise<void> {
    const { meta, actor } = facts
    try {
      const located = await this.locate(facts)
      const data: Prisma.AuditEventUncheckedCreateInput = {
        createdAt: now,
        companyId: actor.companyId,
        actorId: actor.userId,
        actorRole: actor.role,
        subjectUserId: located.subjectUserId,
        action: meta.action,
        resourceType: located.resourceType,
        resourceId: located.resourceId,
        method: facts.method,
        route: facts.route,
        status: facts.status,
        ip: facts.ip,
        userAgent: clip(facts.userAgent, USER_AGENT_MAX_LENGTH),
      }
      if (!isReadAction(meta.action)) {
        await this.prisma.auditEvent.create({ data })
        return
      }
      // A trilha é do acesso do painel aos dados de outra pessoa: quem lê
      // os próprios dados (o funcionário na sessão dele) não entra.
      if (located.subjectUserId === actor.userId) return
      // Duas leituras quase juntas (o painel pede o mesmo detalhe duas vezes)
      // chegam aqui antes de a primeira linha existir. A trava da transação,
      // pela chave da deduplicação, faz a segunda esperar a primeira gravar e
      // então enxergá-la, também com mais de um processo no ar.
      await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${dedupeKey(actor.userId, located.subjectUserId, meta.action)}))`
        if (await this.seenRecently(tx, actor.userId, located.subjectUserId, meta.action, now)) return
        await tx.auditEvent.create({ data })
      })
    } catch (error) {
      this.logger.warn(`Linha da trilha não gravada (${meta.action} em ${facts.route}): ${describeError(error)}`)
    }
  }

  /** De quem são os dados e qual recurso foi tocado. */
  private async locate(facts: AuditRequestFacts): Promise<Located> {
    const { meta, params, captured, actor } = facts
    const subject = meta.subject
    let located: Located = { subjectUserId: null, resourceType: null, resourceId: null }

    if ('resource' in subject) {
      const resourceId = clip(params[subject.param], ID_MAX_LENGTH)
      located = {
        subjectUserId: resourceId === null ? null : await this.ownerOf(subject.resource, resourceId, actor.companyId),
        resourceType: subject.resource,
        resourceId,
      }
    } else if ('param' in subject) {
      located.subjectUserId = clip(params[subject.param], ID_MAX_LENGTH)
    } else if ('body' in subject) {
      const body = facts.body as Record<string, unknown> | null | undefined
      located.subjectUserId = clip(body?.[subject.body], ID_MAX_LENGTH)
    } else {
      located.subjectUserId = clip(captured[subject.response], ID_MAX_LENGTH)
    }

    if (meta.resource) {
      const source = meta.resource
      located.resourceType = source.type
      located.resourceId = clip('param' in source ? params[source.param] : captured[source.response], ID_MAX_LENGTH)
    }
    return located
  }

  /**
   * Dono do recurso, procurado só na empresa de quem pede. Recurso de outra
   * empresa fica sem dono na linha: a tentativa aparece, mas a trilha de uma
   * empresa não passa a contar quem é o funcionário de outra.
   */
  private async ownerOf(kind: AuditResolvableResource, id: string, companyId: string | null): Promise<string | null> {
    switch (kind) {
      case 'session': {
        const row = await this.prisma.telemetrySession.findFirst({ where: { id, worker: { companyId } }, select: { workerId: true } })
        return row?.workerId ?? null
      }
      case 'alert': {
        const row = await this.prisma.operationalAlert.findFirst({ where: { id, worker: { companyId } }, select: { workerId: true } })
        return row?.workerId ?? null
      }
      case 'device': {
        const row = await this.prisma.telemetryDevice.findFirst({ where: { id, worker: { companyId } }, select: { workerId: true } })
        return row?.workerId ?? null
      }
      case 'rescue': {
        const row = await this.prisma.rescue.findFirst({ where: { id, companyId }, select: { injuredId: true } })
        return row?.injuredId ?? null
      }
    }
  }

  private async seenRecently(
    db: Prisma.TransactionClient,
    actorId: string,
    subjectUserId: string | null,
    action: AuditAction,
    now: Date,
  ): Promise<boolean> {
    const row = await db.auditEvent.findFirst({
      where: { actorId, subjectUserId, action, createdAt: { gte: new Date(now.getTime() - READ_DEDUPE_WINDOW_MS) } },
      select: { id: true },
    })
    return row !== null
  }

  /** A trilha da empresa de quem pede, da linha mais nova à mais antiga. */
  async list(caller: JwtUser, query: AuditEventQuery): Promise<AuditEventPage> {
    if (caller.companyId === null) {
      throw new ForbiddenException('Quem não tem empresa não tem trilha de auditoria')
    }
    const limit = Math.min(query.limit ?? AUDIT_EVENTS_DEFAULT_LIMIT, AUDIT_EVENTS_MAX_LIMIT)
    const createdAt: Prisma.DateTimeFilter = {}
    if (query.from) createdAt.gte = new Date(query.from)
    if (query.to) createdAt.lte = new Date(query.to)
    // Um a mais que o pedido: é ele que diz se existe próxima página, sem uma
    // contagem à parte.
    const rows = await this.prisma.auditEvent.findMany({
      where: {
        companyId: caller.companyId,
        ...(query.subjectUserId ? { subjectUserId: query.subjectUserId } : {}),
        ...(query.actorId ? { actorId: query.actorId } : {}),
        ...(query.action ? { action: query.action } : {}),
        ...(query.from || query.to ? { createdAt } : {}),
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    })
    const page = rows.slice(0, limit)
    return {
      items: page.map(toItem),
      nextCursor: rows.length > limit ? page[page.length - 1].id : null,
    }
  }
}
