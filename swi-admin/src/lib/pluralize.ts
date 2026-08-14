// Concordância de número nos headers de listagem. Com o plural fixo no template
// literal, uma empresa com um único administrador lê "Você tem (1)
// administradores cadastrados".
//
// `singular` e `plural` recebem a locução INTEIRA que concorda com o número
// ("administrador cadastrado" / "administradores cadastrados"), porque em
// pt-BR o adjetivo flexiona junto com o substantivo. Devolver só o miolo
// deixaria o call site remontando a frase, e a concordância voltaria a quebrar
// pela borda.
//
// Devolve apenas a locução, SEM o número: os headers imprimem a contagem entre
// parênteses ("Você tem (9) funcionários cadastrados") e embutir o número aqui
// obrigaria cada chamada a desfazer o formato.
export function pluralize(count: number, singular: string, plural: string): string {
  return count === 1 ? singular : plural
}
