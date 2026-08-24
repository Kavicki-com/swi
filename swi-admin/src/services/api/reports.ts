// Relatórios do painel (GET /reports, GET /reports/:id, POST/PATCH) contra o
// backend Nest. Mantém o envelope ServiceResponse pra que as telas de Reports não
// mudem de contrato na migração (mesmo padrão do services/api/users.ts). Os
// avatares dos responsáveis e das atividades são DECORATIVOS — o backend guarda
// responsáveis só como nomes, sem avatar; injetamos avatares fixos no mapeamento
// pra preservar o visual do redesign (AvatarGroup) até o hardware/upload existir.
import type { ServiceResponse } from '@/services/types'
import { apiFetch } from './http'

// Tipos canônicos dos Relatórios (antes moravam em mockApi/reports.ts, hoje morto).
// Statuses mapeiam os valores do DS StatusTag: 'accept' (verde), 'pending'
// (amarelo), 'canceled' (vermelho), 'info' (azul).
export type ReportStatus = 'accept' | 'pending' | 'canceled' | 'info'

// Uma linha de atividade em /reports/:id (seção "Atividades").
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
  /** Nomes da equipe, index-parallel com `avatars` (iniciais + a11y). */
  names: ReadonlyArray<string>
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
  // Grupo de avatares sobrepostos no card da ReportsList ("Responsável:").
  // As primeiras N faces sobrepõem; as restantes viram um badge "+N".
  responsibleAvatars: ReadonlyArray<string>
  // Override opcional quando a demo quer que o badge "+N" indique mais pessoas
  // do que existem no array de avatares visíveis.
  responsibleTotalCount?: number
  // Corpo dos detalhes exibido em /reports/:id ("Detalhes do relatório").
  details?: string
  // Thumbnails de imagem da seção "Imagens".
  images?: ReadonlyArray<string>
  // Lista de atividades da seção "Atividades".
  activities?: ReadonlyArray<ReportActivity>
}

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
  // URLs presigned das fotos dos responsáveis, na MESMA ordem de `responsibles`
  // ('' quando o nome não bate com ninguém do diretório). Opcional: um backend
  // antigo não manda o campo e a UI cai no placeholder.
  responsibleAvatars?: string[]
  details?: string
  images?: string[] // urls presigned (exibição)
  imageKeys?: string[] // keys crus (edição preserva/mescla anexos)
  activities?: RawActivity[]
}

// DTO do GET /reports/:id (detalhe) — soma os comentários.
export type ReportDetailDto = ReportDto & {
  comments?: ReportComment[]
}

// Atividade crua do backend (sem id garantido). responsibleNames/Avatars são a
// equipe REAL da atividade: o backend resolve nome → foto presigned no detalhe.
type RawActivity = {
  id?: string
  title: string
  sector: string
  progress: number
  tone: ReportActivity['tone']
  overflowCount?: number
  responsibleNames?: string[]
  responsibleAvatars?: string[]
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
  // Snapshot dos anexos que ESTE form carregou. Sem ele o PATCH substitui o
  // array cegamente e apaga o que outra pessoa anexou entre o load e o save;
  // com ele o backend separa 'chegou depois' (preserva) de 'removido de
  // propósito' (o único caso em que apaga do bucket). Só existe na edição.
  imageKeysBase?: string[]
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
    // Equipe REAL da atividade (backend resolve nome → foto presigned; ''
    // sem match). Backend antigo sem os campos → sem faces, nunca face errada.
    avatars: a.responsibleAvatars ?? [],
    names: a.responsibleNames ?? [],
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
    // Faces REAIS dos responsáveis (o backend resolve nome → foto do Profile).
    // Backend sem o campo → nenhuma face, nunca uma face errada: avatar
    // decorativo aqui mostra uma cara que não é da pessoa nomeada logo abaixo.
    responsibleAvatars: dto.responsibleAvatars ?? [],
    responsibleTotalCount: (dto.responsibles ?? []).length,
    details: dto.details,
    images: dto.images ?? [],
    activities,
  }
}

export const reportsApi = {
  // `count` = total da EMPRESA (header X-Total-Count), não o tamanho da página:
  // é o que deixa a tela avisar "mostrando 200 de 262" em vez de esconder 62
  // relatórios em silêncio. Sem paginação explícita, o backend devolve os 200
  // mais recentes.
  async list(page?: { limit?: number; offset?: number }): Promise<ServiceResponse<Report[]>> {
    try {
      const qs = new URLSearchParams()
      if (page?.limit != null) qs.set('limit', String(page.limit))
      if (page?.offset != null) qs.set('offset', String(page.offset))
      const suffix = qs.toString() ? `?${qs}` : ''
      let total: number | undefined
      const reports = await apiFetch<ReportDto[]>(
        `/reports${suffix}`,
        {},
        {
          onResponse: (res) => {
            const raw = res.headers?.get?.('X-Total-Count')
            if (raw != null && raw !== '') total = Number(raw)
          },
        },
      )
      const items = reports.map(toReport)
      return { data: items, error: null, count: total ?? items.length }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao carregar') } }
    }
  },

  async get(
    id: string,
  ): Promise<
    ServiceResponse<
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

  async create(input: CreateReportInput): Promise<ServiceResponse<Report>> {
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

  async update(id: string, patch: UpdateReportInput): Promise<ServiceResponse<Report>> {
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

  // Excluir um relatório (DELETE /reports/:id): 204 sem corpo (apiFetch resolve
  // null). O backend apaga os anexos do bucket junto, então não sobra objeto
  // órfão. Só o autor ou um ADMIN pode excluir, e quem opera o painel é ADMIN.
  async remove(id: string): Promise<ServiceResponse<null>> {
    try {
      await apiFetch<null>(`/reports/${id}`, { method: 'DELETE' })
      return { data: null, error: null }
    } catch (e) {
      return { data: null, error: { message: errorMessage(e, 'Falha ao excluir') } }
    }
  },

  async addComment(id: string, body: string): Promise<ServiceResponse<ReportComment>> {
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
