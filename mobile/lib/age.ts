// birthDate ISO → idade em anos completos. Duas telas mostram a idade de outra
// pessoa (ficha do contato no chat e seleção de responsáveis do relatório), e
// ambas exibem a idade calculada a partir da data de nascimento. null = sem data
// no cadastro — quem chama mostra "Não informado", nunca um palpite.
// Nascimento é data de CALENDÁRIO, não instante. O backend guarda @db.Date e
// serializa como meia-noite UTC ('2000-07-27T00:00:00.000Z'); ler isso com os
// getters locais em UTC-3 volta pro dia 26 e erra o aniversário por um dia.
// Por isso o ano/mês/dia saem do texto, sem passar por fuso.
export function ageFrom(birthDate: string | null | undefined): number | null {
  if (!birthDate) return null;
  const parts = /^(\d{4})-(\d{2})-(\d{2})/.exec(birthDate);
  if (!parts) return null;
  const [year, month, day] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  const now = new Date();
  let age = now.getFullYear() - year;
  const beforeBirthday =
    now.getMonth() + 1 < month ||
    (now.getMonth() + 1 === month && now.getDate() < day);
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}
