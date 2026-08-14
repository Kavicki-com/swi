// fatigueEtaMin → "Xh Ym" compacto (105 → "1h45m", 5 → "0h05m").
// Compartilhado entre my-stats e dashboard: mantém o texto sincronizado com o
// valor que alimenta a barra de progresso nas duas telas.
export function formatEta(minutes: number): string {
  const total = Math.max(0, Math.round(minutes));
  const h = Math.floor(total / 60);
  const m = total % 60;
  return `${h}h${String(m).padStart(2, '0')}m`;
}
