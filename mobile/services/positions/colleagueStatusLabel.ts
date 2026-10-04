import type { Colleague, ColleagueStatus } from './types';
import type { PolledRead } from './usePolledRead';

const LABEL: Record<ColleagueStatus, string> = {
  good: 'Bom',
  alert: 'Alerta',
  low: 'Urgente',
  unknown: 'Sem leitura',
};

// O estado de saúde de um colega em palavras, a partir da leitura dos colegas.
// É o mesmo estado que o mapa pinta no pino, e é tudo o que o app sabe da
// saúde de outro funcionário: nenhum número chega até aqui.
export function colleagueStatusLabel(
  read: PolledRead<readonly Colleague[]>,
  workerId: string,
): string {
  // A leitura guarda o dado anterior quando uma releitura falha. Aqui ele não
  // vale: o estado é mostrado como atual, e o de antes da falha ninguém
  // consegue mais confirmar.
  if (read.failed) return 'Indisponível no momento';
  if (read.data === null) return 'Carregando';
  // A rota só lista quem tem posição recente. De quem ficou de fora o app não
  // recebe estado nenhum, e isso não é o mesmo que estar bem.
  const colleague = read.data.find((c) => c.id === workerId);
  return LABEL[colleague?.status ?? 'unknown'];
}
