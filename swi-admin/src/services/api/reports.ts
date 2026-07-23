// Relatórios do painel (GET /reports, GET /reports/:id, POST/PATCH) contra o
// backend Nest. Mantém o envelope MockResponse pra que as telas de Reports não
// mudem de contrato na migração (mesmo padrão do services/api/users.ts). Os
// avatares dos responsáveis e das atividades são DECORATIVOS — o backend guarda
// responsáveis só como nomes, sem avatar; injetamos avatares fixos no mapeamento
// pra preservar o visual do redesign (AvatarGroup) até o hardware/upload existir.
import type { MockResponse } from '@/services/mockApi/types'
import { apiFetch } from './http'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'

// Tipos canônicos dos Relatórios (antes moravam em mockApi/reports.ts, hoje morto).
// Statuses mapeiam os valores do DS StatusTag: 'accept' (verde), 'pending'
// (amarelo), 'canceled' (vermelho), 'info' (azul).
export type ReportStatus = 'accept' | 'pending' | 'canceled' | 'info'

// Uma linha de atividade em /reports/:id (Figma 98:4877 seção "Atividades").
// A linha renderiza: ícone chave | divisor | título + setor + ProgressBar |
// AvatarGroup (count) | ícone location_on. O tone colore a barra: success
// (verde), warning (laranja), error (vermelho).
export type ReportActivity = {
  id: string
  title: string
  sector: string
  progress: number
  tone: 'success' | 'warning' | 'error'
  avatars: ReadonlyArray<string>
  overflowCount?: number
}

export type Report = {
  id: string
  title: string
  summary: string
  status: ReportStatus
  statusLabel: string
  authorName: string
  authorAvatarUri: string
  creationDate: string
  sector: string
  // Lista separada por vírgula de responsáveis — renderizada na seção
  // "Responsáveis" do ReportDetails (footer legado do DS ReportCard).
  responsibles: string
  // Grupo de avatares sobrepostos no card redesenhado da ReportsList
  // ("Responsável:", mockup QA cliente §4). As primeiras N faces sobrepõem;
  // as restantes viram um badge "+N".
  responsibleAvatars: ReadonlyArray<string>
  // Override opcional quando a demo quer que o badge "+N" indique mais pessoas
  // do que existem no array de avatares visíveis.
  responsibleTotalCount?: number
  // Corpo dos detalhes exibido em /reports/:id (Figma 98:4877 "Detalhes do relatório").
  details?: string
  // Thumbnails de imagem da seção "Imagens".
  images?: ReadonlyArray<string>
  // Lista de atividades da seção "Atividades".
  activities?: ReadonlyArray<ReportActivity>
}

// Avatares decorativos: o backend não persiste avatar de responsável, então a
// UI (AvatarGroup) consome esta rotação fixa. Rotação a,b,c,a,b — 5 slots,
// batendo com o mock antigo (mockApi/reports.ts) pra manter o layout idêntico.
const DECOR_AVATARS: ReadonlyArray<string> = [workerA, workerB, workerC, workerA, workerB]

// Contagem decorativa do cluster de responsáveis (badge "+N"). Fixa em 9 (igual
// ao mock antigo) pra reproduzir o Figma: ReportCardV2 mostra 4 faces + "+5". A
// contagem REAL (2 na seed) some com o badge e ainda mostra 4 faces pra 2 pessoas
// — pior que o mock. Decorativo: os nomes reais aparecem no texto `responsibles`
// (comma-joined); o backend guarda responsáveis só como nomes, sem avatar/contagem.
export const DECOR_RESPONSIBLE_TOTAL = 9

// Um comentário no detalhe do relatório (POST /reports/:id/comments responde um).
export type ReportComment = {
  id: string
  body: string
  authorName: string
  authorAvatarUri: string
  createdAt: string
}

// DTO do GET /reports (item da lista). responsibles vem como array de nomes (o
// mapper junta em string); activities/comments só aparecem no detalhe.
export type ReportDto = {
  id: string
  title: string
  summary: string
  status: ReportStatus
  statusLabel: string
  authorName: string
  authorAvatarUri: string
  creationDate: string // dd/mm/yyyy
  sector: string
  responsibles: string[]
  details?: string
  images?: string[] // urls presigned (exibição)
  imageKeys?: string[] // keys crus (edição preserva/mescla anexos)
  activities?: RawActivity[]
}

// DTO do GET /reports/:id (detalhe) — soma os comentários.
export type ReportDetailDto = ReportDto & {
  comments?: ReportComment[]
}

// Atividade crua do backend (sem id garantido, sem avatares — decorativos entram
// no mapeamento).
type RawActivity = {
  id?: string
  title: string
  sector: string
  progress: number
  tone: ReportActivity['tone']
  overflowCount?: number
}

// Corpo do POST /reports — cadastro pelo painel. Campos opcionais ausentes NÃO
// entram no corpo (JSON.stringify descarta `undefined`).
export type CreateReportInput = {
  title: string
  summary?: string
  details?: string
  responsibles?: string[]
  imageKeys?: string[]
}

// Corpo do PATCH /reports/:id — edição parcial (qualquer subconjunto).
export type UpdateReportInput = {
  title?: string
  summary?: string
  details?: string
  responsibles?: string[]
  imageKeys?: string[]
  status?: ReportStatus
  statusLabel?: string
}

const errorMessage = (e: unknown, fallback: string) => (e instanceof Error ? e.message : fallback)

// DTO → Report (UI). responsibles (array de nomes) → string separada por vírgula;
// avatares (responsibleAvatars, e por-linha nas atividades) são DECORATIVOS.
function toReport(dto: ReportDto): Report {
  const activities = (dto.activities ?? []).map((a, i) => ({
    id: a.id ?? `act-${i}`, // backend pode não mandar id → sintetiza um estável por posição
    title: a.title,
    sector: a.sector,
    progress: a.progress,
    tone: a.tone,
    overflowCount: a.overflowCount,
    avatars: DECOR_AVATARS, // decorativo: atividades do backend não carregam avatar
  }))
  return {
    id: dto.id,
    title: dto.title,
    summary: dto.summary,
    status: dto.status,
    statusLabel: dto.statusLabel,
    authorName: dto.authorName,
    authorAvatarUri: dto.authorAvatarUri,
    creationDate: dto.creationDate,
    sector: dto.sector,
    responsibles: (dto.responsibles ?? []).join(', '),
    responsibleAvatars: DECOR_AVATARS, // decorativo: backend guarda só nomes
    responsibleTotalCount: DECOR_RESPONSIBLE_TOTAL, // decorativo (Figma): +N badge
    details: dto.details,
    images: dto.images ?? [],
    activities,
  }
}

export const reportsApi = {
  async list(): Promise<MockResponse<Report[]>> {
    try {
      const reports = await apiFetch<ReportDto[]>('/reports')
      return { data: reports.map(toReport), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
    }
  },

  async get(
    id: string,
  ): Promise<
    MockResponse<
      | (Report & { comments: ReportComment[]; imageKeys: string[]; responsibleNames: string[] })
      | null
    >
  > {
    try {
      const dto = await apiFetch<ReportDetailDto>(`/reports/${id}`)
      // imageKeys crus (não os `images` presigned) pro form de edição preservar/mesclar anexos.
      // responsibleNames crus (o array, não a string comma-joined que o mapper produz) pro form
      // de edição re-semear a seleção sem depender de split(', ') — lossy se um nome tiver ", ".
      return {
        data: {
          ...toReport(dto),
          comments: dto.comments ?? [],
          imageKeys: dto.imageKeys ?? [],
          responsibleNames: dto.responsibles ?? [],
        },
        error: null,
      }
    } catch (e) {
      // A tela só distingue loading × (data|null) — qualquer erro (404, rede) cai
      // na tela "não encontrado". Mantém o envelope preenchido por consistência.
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
    }
  },

  async create(input: CreateReportInput): Promise<MockResponse<Report>> {
    try {
      const created = await apiFetch<ReportDto>('/reports', {
        method: 'POST',
        body: JSON.stringify(input),
      })
      return { data: toReport(created), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao cadastrar') } }
    }
  },

  async update(id: string, patch: UpdateReportInput): Promise<MockResponse<Report>> {
    try {
      const updated = await apiFetch<ReportDto>(`/reports/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      })
      return { data: toReport(updated), error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao salvar') } }
    }
  },

  async addComment(id: string, body: string): Promise<MockResponse<ReportComment>> {
    try {
      const comment = await apiFetch<ReportComment>(`/reports/${id}/comments`, {
        method: 'POST',
        body: JSON.stringify({ body }),
      })
      return { data: comment, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao comentar') } }
    }
  },
}
