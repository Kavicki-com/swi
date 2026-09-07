// O horário de Brasília é um fato do país, e por isso mora aqui e não dentro
// de uma fatia. A telemetria precisa dele para saber onde o dia monitorado
// começa; os relatórios precisam dele para escrever uma data na tela. Antes,
// cada um tinha a própria aritmética, e nada acusaria se elas divergissem.

/**
 * BRT é UTC-3 fixo: o Brasil aboliu o horário de verão em 2019. Deslocamento,
 * nunca regra. Quem traduz instante em dia monitorado é o domínio da
 * telemetria; quem escreve data na tela é quem formata. Os dois partem daqui.
 *
 * Sem depender de ICU nem de base de fusos: o runtime do contêiner pode vir
 * sem elas, e uma data errada em silêncio é pior que uma dependência a menos.
 */
export const BRT_OFFSET_MS = -3 * 60 * 60 * 1000

/** Data em Brasília no formato dd/MM/aaaa, que é como o cliente lê. */
export function formatBrtDate(instant: Date): string {
  const brt = new Date(instant.getTime() + BRT_OFFSET_MS)
  const day = String(brt.getUTCDate()).padStart(2, '0')
  const month = String(brt.getUTCMonth() + 1).padStart(2, '0')
  return `${day}/${month}/${brt.getUTCFullYear()}`
}
