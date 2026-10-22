// Horários das telas de vitais, no relógio do aparelho. Moram aqui, e não na
// visão do dashboard, porque a ausência por métrica (metricAbsence.ts) também
// diz de quando é uma falha, e a visão importa a ausência.

/** "14:59". */
export const clock = (iso: string) =>
  new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

const pad2 = (n: number) => String(n).padStart(2, '0');

/** "29/09". */
export const dayMonth = (iso: string) => {
  const d = new Date(iso);
  return `${pad2(d.getDate())}/${pad2(d.getMonth() + 1)}`;
};

/** A medição é do mesmo dia (no relógio do aparelho) que o instante da leitura. */
export const isSameDay = (measuredAt: string, observedAt: string | number) =>
  new Date(measuredAt).toDateString() === new Date(observedAt).toDateString();

/**
 * De quando é uma medição, para completar frases: "às 14:59" se é de hoje,
 * "em 29/09 às 14:59" se é de outro dia. Pressão e oxigenação valem por dias
 * no backend, e o último batimento fica guardado sem prazo: só o horário
 * faria uma medição de anteontem parecer de hoje.
 */
export const whenLabel = (measuredAt: string, observedAt: string | number) =>
  isSameDay(measuredAt, observedAt)
    ? `às ${clock(measuredAt)}`
    : `em ${dayMonth(measuredAt)} às ${clock(measuredAt)}`;

/** Desde quando, na mesma regra: "14:59" de hoje, "29/09 às 14:59" de outro dia. */
export const sinceLabel = (since: string, observedAt: string | number) =>
  isSameDay(since, observedAt) ? clock(since) : `${dayMonth(since)} às ${clock(since)}`;
