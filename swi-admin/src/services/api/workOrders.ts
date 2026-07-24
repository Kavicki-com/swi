// Client do domínio Tarefas (work orders) contra o backend Nest. Todas as rotas
// exigem role ADMIN — quem impõe é o backend (JwtAuthGuard + RolesGuard na
// classe do controller); aqui não se checa nada.
import { apiFetch } from './http'

// Status do PAI. O item tem um estado a mais (paused) — ver WorkOrderItemStatus.
export type WorkOrderStatus = 'pending' | 'in_progress' | 'done'

// Status do ITEM do checklist: superset do pai. Tipo separado de propósito —
// reusar WorkOrderStatus aqui deixaria 'paused' passar batido nos switches da UI.
export type WorkOrderItemStatus = 'pending' | 'in_progress' | 'paused' | 'done'

// Linha da lista (toRowDto). sector vem '' quando nulo no banco, nunca null.
export type WorkOrderRow = {
  id: string
  title: string
  sector: string
  status: WorkOrderStatus
  progressPct: number
  responsibleCount: number
  // Index-parallel com responsibleCount: responsável sem avatar ocupa a posição
  // com ''. Não filtrar — o "+N" do overflow conta em cima do count.
  responsibleAvatars: string[]
}

// Card de worker: responsável no detalhe e item do diretório de atribuíveis.
// Sem bloodType (decisão do backend). birthDate é ISO datetime, não data de
// calendário — formatar antes de exibir.
export type AssignableWorker = {
  id: string
  name: string
  jobTitle: string
  sector: string
  birthDate: string | null
  avatar: string
}

export type WorkOrderItem = {
  id: string
  title: string
  description: string
  status: WorkOrderItemStatus
}

// Detalhe (toDetailDto). Os textos opcionais chegam como '' (nunca null); só
// estimatedMinutes, startDate e dueDate são nuláveis de verdade.
export type WorkOrderDetail = {
  id: string
  title: string
  summary: string
  details: string
  sector: string
  estimatedMinutes: number | null
  // ISO datetime ('2026-07-21T00:00:00.000Z'), NÃO data de calendário. Devolver
  // startDate/dueDate direto pro update() compila e falha em runtime com 400 —
  // corte pra 'AAAA-MM-DD' antes de mandar de volta.
  startDate: string | null
  dueDate: string | null
  createdAt: string
  status: WorkOrderStatus
  progressPct: number
  author: { name: string; avatar: string }
  responsibles: AssignableWorker[]
  items: WorkOrderItem[]
  images: string[]
  // Keys cruas em par posicional com `images` (images[i] assina imageKeys[i]).
  // São o que o PATCH aceita de volta — a URL assinada não passa no regex do DTO.
  imageKeys: string[]
}

// Item do payload de escrita. `id` opcional expressa a reconciliação do PATCH:
// COM id = atualiza aquele item; SEM id = cria; item existente ausente da lista
// = apagado. No POST o id é ignorado (item é sempre novo).
// Omitir a chave `items` inteira é diferente de mandar []: omitida, o checklist
// fica intocado (dá pra editar só o título com update(id, { title })); [] o
// backend rejeita com 400 ('a tarefa precisa de pelo menos 1 item').
export type WorkOrderItemInput = { id?: string; title: string; description?: string }

// Datas aqui são de CALENDÁRIO ('AAAA-MM-DD'), não ISO datetime — o backend
// valida com @IsCalendarDate e rejeita o que vier do toISOString() da resposta.
export type WorkOrderInput = {
  title: string
  summary?: string
  details?: string
  sector?: string
  estimatedMinutes?: number
  startDate?: string
  dueDate?: string
  responsibleIds: string[]
  // Só keys emitidas pelo presign: 'order/<uuid>.jpg' ou '.png'.
  imageKeys?: string[]
  items?: WorkOrderItemInput[]
}

// PATCH parcial: todo campo é opcional. Cuidado com responsibleIds — opcional,
// mas se vier NÃO pode ser [] (o backend responde 400).
export type WorkOrderUpdateInput = Partial<WorkOrderInput>

export const workOrdersApi = {
  // O backend limita a 200 linhas (mais recentes primeiro) e não pagina.
  list: (status?: WorkOrderStatus) =>
    apiFetch<WorkOrderRow[]>(`/work-orders${status ? `?status=${status}` : ''}`),

  get: (id: string) => apiFetch<WorkOrderDetail>(`/work-orders/${id}`),

  // Create e update devolvem o DETALHE recarregado, não o eco do payload.
  create: (input: WorkOrderInput) =>
    apiFetch<WorkOrderDetail>('/work-orders', { method: 'POST', body: JSON.stringify(input) }),

  update: (id: string, input: WorkOrderUpdateInput) =>
    apiFetch<WorkOrderDetail>(`/work-orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),

  assignable: () => apiFetch<AssignableWorker[]>('/work-orders/assignable'),
}
