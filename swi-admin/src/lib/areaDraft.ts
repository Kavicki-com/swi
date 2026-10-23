// Rascunho da área de evacuação desenhada no mapa. Vetorização sequencial:
// cada clique põe um ponto ligado ao anterior, e a área só vale depois que o
// gestor fecha o trajeto clicando no primeiro ponto. O fechamento é
// obrigatório porque a área define exatamente quem está sendo evacuado.
import type { AreaVertex } from './evacuationArea'

export interface AreaDraft {
  vertices: AreaVertex[]
  closed: boolean
}

export const MIN_AREA_VERTICES = 3

export const EMPTY_DRAFT: AreaDraft = { vertices: [], closed: false }

// Trajeto fechado não cresce: para mexer, desfazer reabre.
export function addVertex(draft: AreaDraft, vertex: AreaVertex): AreaDraft {
  if (draft.closed) return draft
  return { vertices: [...draft.vertices, vertex], closed: false }
}

export function canClose(draft: AreaDraft): boolean {
  return !draft.closed && draft.vertices.length >= MIN_AREA_VERTICES
}

export function closeDraft(draft: AreaDraft): AreaDraft {
  return canClose(draft) ? { ...draft, closed: true } : draft
}

// Fechado, desfazer só reabre; aberto, tira o último ponto.
export function undoDraft(draft: AreaDraft): AreaDraft {
  if (draft.closed) return { ...draft, closed: false }
  return { vertices: draft.vertices.slice(0, -1), closed: false }
}

export function moveVertex(draft: AreaDraft, index: number, vertex: AreaVertex): AreaDraft {
  return { ...draft, vertices: draft.vertices.map((p, k) => (k === index ? vertex : p)) }
}

export function isReady(draft: AreaDraft): boolean {
  return draft.closed && draft.vertices.length >= MIN_AREA_VERTICES
}
