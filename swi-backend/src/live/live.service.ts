import { Injectable, Logger } from '@nestjs/common'
import { JwtService } from '@nestjs/jwt'
import { requireJwtSecret } from '../auth/jwt-secret'
import { describeError } from '../common/describe-error'
import { PrismaService } from '../prisma/prisma.service'
import { LiveRegistry, type LiveBroadcastSummary, type LiveEnded } from './live-registry'

/** SDP de vídeo fica em poucos KB; o teto só barra lixo. */
export const LIVE_MAX_SDP_LENGTH = 64 * 1024
const MAX_ID_LENGTH = 64
const MAX_CANDIDATE_LENGTH = 2048

export type LiveError = 'unauthorized' | 'forbidden' | 'no-company' | 'not-live' | 'full' | 'not-found' | 'invalid'

export type LiveReply = { ok: true; sessionId?: string } | { ok: false; error: LiveError }

/** Aviso a entregar: a um socket só, ou às salas dos usuários. */
export type LiveDelivery =
  | { socketId: string; event: string; payload: unknown }
  | { userIds: string[]; event: string; payload: unknown }

export interface LiveOutcome {
  reply: LiveReply
  deliveries: LiveDelivery[]
}

export type LiveRelayKind = 'offer' | 'answer' | 'candidate'

interface Speaker {
  id: string
  role: string
  companyId: string | null
  name: string
}

interface CandidateInit {
  candidate: string
  sdpMid?: string | null
  sdpMLineIndex?: number | null
  usernameFragment?: string | null
}

const refuse = (error: LiveError): LiveOutcome => ({ reply: { ok: false, error }, deliveries: [] })

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_ID_LENGTH

const isOptionalText = (value: unknown, max: number): boolean =>
  value === undefined || value === null || (typeof value === 'string' && value.length <= max)

/** Copia só os campos de RTCIceCandidateInit; qualquer outro fica para trás. */
function candidateOf(value: unknown): CandidateInit | null {
  if (!isRecord(value)) return null
  const { candidate, sdpMid, sdpMLineIndex, usernameFragment } = value
  if (typeof candidate !== 'string' || candidate.length > MAX_CANDIDATE_LENGTH) return null
  if (!isOptionalText(sdpMid, MAX_ID_LENGTH) || !isOptionalText(usernameFragment, MAX_ID_LENGTH)) return null
  if (sdpMLineIndex !== undefined && sdpMLineIndex !== null && !(Number.isInteger(sdpMLineIndex) && (sdpMLineIndex as number) >= 0)) {
    return null
  }
  const copy: CandidateInit = { candidate }
  if (sdpMid !== undefined) copy.sdpMid = sdpMid as string | null
  if (sdpMLineIndex !== undefined) copy.sdpMLineIndex = sdpMLineIndex as number | null
  if (usernameFragment !== undefined) copy.usernameFragment = usernameFragment as string | null
  return copy
}

/**
 * Sinalização da transmissão ao vivo: o celular do funcionário oferta vídeo e
 * o painel do administrador responde, direto entre os dois (WebRTC). O
 * servidor só apresenta um ao outro e repassa oferta, resposta e candidatos.
 *
 * O socket guarda só o id do usuário, e só depois de conferir o banco; por
 * isso ligar e assistir verificam o token de novo e releem papel, empresa e
 * situação, como o REST faz a cada requisição. Depois disso, o resto vale
 * apenas entre os dois sockets da sessão.
 */
@Injectable()
export class LiveService {
  private readonly logger = new Logger(LiveService.name)

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    private readonly registry: LiveRegistry,
  ) {}

  async start(socketId: string, token: string): Promise<LiveOutcome> {
    const speaker = await this.identify(token)
    if (!speaker) return refuse('unauthorized')
    if (speaker.role !== 'WORKER') return refuse('forbidden')
    if (speaker.companyId === null) return refuse('no-company')

    const result = this.registry.start(
      { workerId: speaker.id, companyId: speaker.companyId, name: speaker.name, socketId },
      new Date(),
    )
    if (!result.fresh) return { reply: { ok: true }, deliveries: [] }

    const deliveries: LiveDelivery[] = []
    if (result.replaced) {
      // O aparelho antigo para de transmitir e fecha todas as conexões dele,
      // haja ou não alguém assistindo.
      deliveries.push({ socketId: result.replaced.socketId, event: 'live.closed', payload: { workerId: speaker.id } })
      for (const { sessionId, viewerSocketId } of result.replaced.sessions) {
        deliveries.push({ socketId: viewerSocketId, event: 'live.ended', payload: { sessionId, workerId: speaker.id } })
      }
    }
    const summary = this.registry.list(speaker.companyId).find((b) => b.workerId === speaker.id)
    deliveries.push(...(await this.toAdmins(speaker.companyId, 'live.started', summary)))
    return { reply: { ok: true }, deliveries }
  }

  /**
   * Parar é idempotente: quem não transmite recebe ok sem efeito. `userId` é
   * o do socket, já conferido na conexão: o funcionário para a própria
   * transmissão também de outro socket dele.
   */
  async stop(socketId: string, userId?: string): Promise<LiveOutcome> {
    const ended = this.registry.stop(socketId, userId)
    if (!ended) return { reply: { ok: true }, deliveries: [] }
    const deliveries: LiveDelivery[] = []
    // Parou por outro socket: o que transmitia desliga a câmera também.
    if (ended.socketId !== socketId) {
      deliveries.push({ socketId: ended.socketId, event: 'live.closed', payload: { workerId: ended.workerId } })
    }
    deliveries.push(...(await this.endedDeliveries(ended)))
    return { reply: { ok: true }, deliveries }
  }

  async watch(socketId: string, token: string, payload: unknown): Promise<LiveOutcome> {
    if (!isRecord(payload) || !isId(payload.workerId)) return refuse('invalid')
    const speaker = await this.identify(token)
    if (!speaker) return refuse('unauthorized')
    if (speaker.role !== 'ADMIN') return refuse('forbidden')
    // Administrador sem empresa não lê telemetria de ninguém; aqui também não.
    if (speaker.companyId === null) return refuse('not-live')

    const result = this.registry.watch({ workerId: payload.workerId, companyId: speaker.companyId, viewerSocketId: socketId })
    if (!result.ok) return refuse(result.error)
    const deliveries: LiveDelivery[] = []
    if (result.replacedSessionId !== null) {
      deliveries.push({ socketId: result.broadcasterSocketId, event: 'live.viewer-left', payload: { sessionId: result.replacedSessionId } })
    }
    deliveries.push({ socketId: result.broadcasterSocketId, event: 'live.viewer', payload: { sessionId: result.sessionId } })
    return { reply: { ok: true, sessionId: result.sessionId }, deliveries }
  }

  /**
   * Sair é idempotente: sessão alheia ou já encerrada recebe ok sem efeito.
   *
   * `live.viewer-left` é ORDEM para o celular fechar a conexão daquela
   * sessão, não só aviso: o vídeo vai direto ao painel, e tirar a sessão do
   * registro não corta a imagem. É também o que tira a imagem de um
   * administrador desativado (a queda do socket dele chega aqui pelo leave).
   */
  unwatch(socketId: string, payload: unknown): LiveOutcome {
    if (!isRecord(payload) || !isId(payload.sessionId)) return refuse('invalid')
    const left = this.registry.unwatch(payload.sessionId, socketId)
    if (!left) return { reply: { ok: true }, deliveries: [] }
    return {
      reply: { ok: true },
      deliveries: [{ socketId: left.broadcasterSocketId, event: 'live.viewer-left', payload: { sessionId: payload.sessionId } }],
    }
  }

  /**
   * Repasse dentro da sessão. Só o celular oferta e só o painel responde;
   * candidatos vão nos dois sentidos. O conteúdo segue copiado campo a campo,
   * nunca o objeto recebido.
   */
  relay(kind: LiveRelayKind, socketId: string, payload: unknown): LiveOutcome {
    if (!isRecord(payload) || !isId(payload.sessionId)) return refuse('invalid')
    const sessionId = payload.sessionId
    let body: Record<string, unknown>
    if (kind === 'candidate') {
      const candidate = candidateOf(payload.candidate)
      if (!candidate) return refuse('invalid')
      body = { sessionId, candidate }
    } else {
      const { sdp } = payload
      if (typeof sdp !== 'string' || sdp.length === 0 || sdp.length > LIVE_MAX_SDP_LENGTH) return refuse('invalid')
      body = { sessionId, sdp }
    }

    const route = this.registry.route(sessionId, socketId)
    if (!route) return refuse('not-found')
    if (kind === 'offer' && route.from !== 'broadcaster') return refuse('forbidden')
    if (kind === 'answer' && route.from !== 'viewer') return refuse('forbidden')
    return { reply: { ok: true }, deliveries: [{ socketId: route.to, event: `live.${kind}`, payload: body }] }
  }

  /** Socket caiu: o que ele transmitia acaba, e as sessões em que assistia também. */
  async leave(socketId: string): Promise<LiveDelivery[]> {
    const { ended, left } = this.registry.leave(socketId)
    const deliveries: LiveDelivery[] = left.map(({ sessionId, broadcasterSocketId }) => ({
      socketId: broadcasterSocketId,
      event: 'live.viewer-left',
      payload: { sessionId },
    }))
    if (ended) deliveries.push(...(await this.endedDeliveries(ended)))
    return deliveries
  }

  list(companyId: string | null): LiveBroadcastSummary[] {
    return companyId === null ? [] : this.registry.list(companyId)
  }

  private async endedDeliveries(ended: LiveEnded): Promise<LiveDelivery[]> {
    const deliveries: LiveDelivery[] = ended.viewers.map(({ sessionId, viewerSocketId }) => ({
      socketId: viewerSocketId,
      event: 'live.ended',
      payload: { sessionId, workerId: ended.workerId },
    }))
    deliveries.push(...(await this.toAdmins(ended.companyId, 'live.stopped', { workerId: ended.workerId })))
    return deliveries
  }

  /**
   * Aviso aos administradores ativos da empresa. Falha na consulta só perde o
   * aviso: o painel relê a lista pela API ao reconectar e ao abrir a aba.
   */
  private async toAdmins(companyId: string, event: string, payload: unknown): Promise<LiveDelivery[]> {
    try {
      const rows = await this.prisma.user.findMany({
        where: { role: 'ADMIN', companyId, active: true },
        select: { id: true },
      })
      const userIds = rows.map((row) => row.id)
      return userIds.length === 0 ? [] : [{ userIds, event, payload }]
    } catch (error) {
      this.logger.warn(`Falha ao avisar os administradores da transmissão: ${describeError(error)}`)
      return []
    }
  }

  /** Quem fala no socket, relido do banco; null para token ruim ou conta inativa. */
  private async identify(token: string): Promise<Speaker | null> {
    if (!token) return null
    try {
      const { sub } = this.jwt.verify<{ sub: string }>(token, { secret: requireJwtSecret() })
      const user = await this.prisma.user.findUnique({
        where: { id: sub },
        select: { id: true, role: true, companyId: true, active: true, name: true, profile: { select: { fullName: true } } },
      })
      if (!user || !user.active) return null
      // Mesmo nome que o chat e os relatórios mostram para a pessoa.
      return { id: user.id, role: user.role, companyId: user.companyId, name: user.profile?.fullName ?? user.name }
    } catch {
      return null
    }
  }
}
