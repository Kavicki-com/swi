// Cargos de STAFF — quem revisa relatório, por oposição a quem executa.
//
// Radicais, não palavras inteiras: o cargo é digitado à mão no cadastro e
// aparece flexionado ("Supervisor", "Supervisora", "Supervisão de Frota",
// "Coordenação de Turno"). O radical cobre as três formas sem uma entrada por
// flexão.
//
// ALLOWLIST de propósito. Uma blocklist ("tudo menos Operador") aceitaria
// qualquer cargo novo por omissão, e aqui errar pra mais significa devolver o
// operador como revisor.
const STAFF_STEMS = [
  'admin', // Administrador, Administrativo
  'gerent', // Gerente, Gerência
  'supervis', // Supervisor, Supervisora, Supervisão
  'coorden', // Coordenador, Coordenação
  'encarregad', // Encarregado, Encarregada
  'analista',
  'diretor',
  'engenheir', // Engenheiro, Engenheira
  'chefe',
] as const

/** Remove acento e caixa: "Analista de Segurança" → "analista de seguranca". */
function normalize(v: string): string {
  return v
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
}

/**
 * `true` quando o cargo declarado é de staff.
 *
 * Cargo ausente devolve `false`: 2 dos 12 aprovados estão sem cargo, e sem
 * declaração não dá pra afirmar que a pessoa revisa relatório. O chamador
 * ainda aceita quem tem `role: 'ADMIN'` independentemente do cargo — a
 * autorização não depende de texto livre.
 */
export function isStaffJobTitle(jobTitle: string | null | undefined): boolean {
  if (!jobTitle?.trim()) return false
  const n = normalize(jobTitle)
  return STAFF_STEMS.some((stem) => n.includes(stem))
}
