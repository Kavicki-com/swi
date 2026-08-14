/**
 * Leitor do diretório central de um ZIP.
 *
 * Existe para que o verificador leia o ARTEFATO que vai ser entregue, e não a
 * lista que o exportador acha que escreveu. Conferir o pacote contra a própria
 * intenção do gerador não prova nada; conferir contra o commit, sim.
 *
 * Lê só o índice, nunca descomprime: o que se quer saber é quais caminhos
 * existem e quantos são.
 */

const FIM_DIRETORIO_CENTRAL = 0x06054b50
const ENTRADA_DIRETORIO_CENTRAL = 0x02014b50

/**
 * O registro de fim tem tamanho variável por causa do comentário do arquivo,
 * então a busca é de trás pra frente. 22 bytes é o registro sem comentário e
 * 0xffff é o comentário máximo.
 */
function achaFimDiretorioCentral(buffer) {
  const minimo = 22
  if (buffer.length < minimo) throw new Error('arquivo pequeno demais para ser um ZIP')
  const limite = Math.max(0, buffer.length - minimo - 0xffff)
  for (let i = buffer.length - minimo; i >= limite; i -= 1) {
    if (buffer.readUInt32LE(i) === FIM_DIRETORIO_CENTRAL) return i
  }
  throw new Error('fim do diretório central não encontrado: o arquivo não é um ZIP válido')
}

/** Caminhos declarados no diretório central, na ordem em que aparecem. */
export function listarEntradas(buffer) {
  const fim = achaFimDiretorioCentral(buffer)
  const total = buffer.readUInt16LE(fim + 10)
  let posicao = buffer.readUInt32LE(fim + 16)

  const entradas = []
  for (let i = 0; i < total; i += 1) {
    if (buffer.readUInt32LE(posicao) !== ENTRADA_DIRETORIO_CENTRAL) {
      throw new Error(`entrada ${i} do diretório central com assinatura inesperada`)
    }
    const tamanhoNome = buffer.readUInt16LE(posicao + 28)
    const tamanhoExtra = buffer.readUInt16LE(posicao + 30)
    const tamanhoComentario = buffer.readUInt16LE(posicao + 32)
    const nome = buffer.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome)
    entradas.push(nome)
    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario
  }
  return entradas
}
