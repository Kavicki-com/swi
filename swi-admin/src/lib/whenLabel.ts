// Quando algo aconteceu, do jeito que o painel escreve: "às 14:32" se foi hoje
// e "em 03/10 às 14:32" se foi em outro dia, para uma leitura de ontem não
// parecer de agora. Usa o relógio do computador de quem está olhando.
export function whenLabel(iso: string, now: number): string | null {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return null
  const time = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === new Date(now).toDateString()) return `às ${time}`
  return `em ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} às ${time}`
}
