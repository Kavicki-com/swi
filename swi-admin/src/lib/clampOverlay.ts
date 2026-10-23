// Posição de um cartão flutuante sobre o mapa, num eixo (vale para left e para
// top): no ponto desejado (pino mais deslocamento) quando cabe, encostado na
// borda quando não cabe. O contêiner do mapa corta o que passa da borda, e um
// botão cortado não recebe clique.
//
// `overhangStart` e `overhangEnd` são o que o cartão desenha fora da própria
// caixa (o X de fechar sobe e sai pela direita): entram na conta para não
// serem cortados. Sem medida ainda (tamanho zero), devolve o ponto desejado.
export function clampOverlay({
  anchor,
  offset,
  size,
  container,
  overhangStart = 0,
  overhangEnd = 0,
}: {
  anchor: number
  offset: number
  size: number
  container: number
  overhangStart?: number
  overhangEnd?: number
}): number {
  const wanted = anchor + offset
  if (size <= 0 || container <= 0) return wanted
  // Cartão maior que o mapa: o início ganha, o fim é que sai.
  return Math.max(overhangStart, Math.min(wanted, container - size - overhangEnd))
}
