// Paginação local da lista, no cliente, sobre o que já veio do backend (teto de
// 200). O seletor de itens por página (MEL-04) muda `pageSize`; a fatia e a
// contagem de páginas saem daqui para a lista e para o Pagination do DS.

/** Opções do seletor "itens por página" (MEL-04). */
export const PAGE_SIZE_OPTIONS = [5, 25, 50, 100] as const

/** Quantidade padrão por página. */
export const DEFAULT_PAGE_SIZE = 25

/** Número de páginas, nunca menos de 1 (lista vazia ainda é uma página). */
export const pageCountOf = (total: number, pageSize: number): number =>
  Math.max(1, Math.ceil(total / pageSize))

/** Página válida dentro de [1, pageCount], para busca/exclusão não deixarem fora de faixa. */
export const clampPage = (page: number, pageCount: number): number =>
  Math.min(Math.max(1, page), pageCount)

/** Fatia da página atual, já com a página saneada. */
export const pageSlice = <T>(items: T[], page: number, pageSize: number): T[] => {
  const current = clampPage(page, pageCountOf(items.length, pageSize))
  return items.slice((current - 1) * pageSize, current * pageSize)
}
