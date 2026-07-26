// Idade pra exibição. `ageFrom` (services/api/users.ts) devolve 0 quando o
// Profile não tem data de nascimento — pra um trabalhador isso é "não
// informado", não "recém-nascido". Sem este formatter as telas mostravam
// "0 anos" (achado do QA 2026-07-24).
export function formatAge(age: number | null | undefined): string {
  if (age == null || age <= 0) return '—'
  return age === 1 ? '1 ano' : `${age} anos`
}
