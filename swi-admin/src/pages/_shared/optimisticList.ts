// Reinserção de linha em lista com exclusão otimista, compartilhada pelas duas
// listas do diretório (funcionários e admins).
//
// Mora aqui, e não copiada nos dois handleRemove, porque a regra é sutil: entre
// a remoção otimista e a resposta do backend a lista PODE mudar (um refetch
// resolve, outra exclusão acontece), e cada detalhe abaixo existe por causa
// disso. Duplicada, ela divergiria na primeira correção feita só de um lado.

/** Item de lista que este módulo sabe posicionar. */
type ComId = { id: string }

/**
 * Onde `id` está na lista AGORA, descrito por âncora e não por índice: o índice
 * é um número que envelhece durante o await, enquanto "vem logo depois do
 * Fulano" continua verdadeiro mesmo que a lista inteira se desloque.
 *
 * `pos: -1` significa que o item nem estava na lista, e isso é informação: quem
 * não chegou a ser removido não tem o que ser devolvido.
 */
export function ancoraDe<T extends ComId>(
  lista: ReadonlyArray<T>,
  id: string,
): { pos: number; anteriorId: string | null } {
  const pos = lista.findIndex((x) => x.id === id)
  const anterior = pos > 0 ? lista[pos - 1] : undefined
  return { pos, anteriorId: anterior?.id ?? null }
}

/**
 * Devolve `item` ao lugar de onde saiu, logo depois de `anteriorId` (ou no
 * topo, quando ele era o primeiro da lista).
 *
 * Idempotente: se um refetch concorrente já recolocou o item, a lista volta
 * intacta em vez de duplicar a linha.
 *
 * Âncora sumida (o vizinho também saiu no meio do caminho) cai no FIM: sem
 * referência, o fim é o único lugar honesto, e fingir a posição antiga
 * embaralharia a lista na cara de quem só tentou excluir.
 */
export function reinserirAncorado<T extends ComId>(
  prev: ReadonlyArray<T>,
  item: T,
  anteriorId: string | null,
): T[] {
  if (prev.some((x) => x.id === item.id)) return [...prev]
  const next = [...prev]
  if (anteriorId === null) {
    next.unshift(item)
    return next
  }
  const anterior = next.findIndex((x) => x.id === anteriorId)
  if (anterior < 0) next.push(item)
  else next.splice(anterior + 1, 0, item)
  return next
}
