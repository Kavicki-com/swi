// Fadiga de um COLEGA (ficha do contato no chat). É dado de smartband, então
// segue simulado até o hardware existir: por decisão de produto, só o que
// depende da pulseira é simulado. Determinístico por workerId, a mesma ideia do
// painel, para que a mesma pessoa sempre renda o mesmo valor e pessoas
// diferentes rendam valores diferentes. Valor fixo faria a tela afirmar que o
// time inteiro tem exatamente a mesma fadiga.
//
// NÃO é a mesma série do painel. São geradores independentes, e vão continuar
// divergindo até a smartband virar fonte única.

function hash(str: string): number {
  let h = 0;
  for (let i = 0; i < str.length; i += 1) {
    h = (h << 5) - h + str.charCodeAt(i);
    h |= 0; // 32-bit
  }
  return Math.abs(h);
}

export interface ContactFatigue {
  pct: number;      // 0-100
  etaMin: number;   // minutos até a fadiga total
}

// Faixa 20-85%: nem "acabou de chegar" nem "prestes a colapsar" pra todo mundo.
const MIN_PCT = 20;
const SPAN_PCT = 66;

// Jornada de referência (8h) — o que sobra de fadiga vira o tempo restante.
const SHIFT_MIN = 8 * 60;

export function simulatedFatigueFor(workerId: string): ContactFatigue {
  if (!workerId) return { pct: 0, etaMin: SHIFT_MIN };
  const pct = MIN_PCT + (hash(workerId) % SPAN_PCT);
  const etaMin = Math.round((SHIFT_MIN * (100 - pct)) / 100);
  return { pct, etaMin };
}
