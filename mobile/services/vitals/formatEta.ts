// fatigueEtaMin → "Xh Ym" compacto (105 → "1h45m", 5 → "0h05m").
// Morava embutido no my-stats; o dashboard não alcançava e por isso exibia a
// string fixa "1h45m" logo abaixo de uma barra que já usava o valor real —
// a barra andava e o texto ao lado não (QA 2026-07-26).
export function formatEta(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, '0')}m`;
}
