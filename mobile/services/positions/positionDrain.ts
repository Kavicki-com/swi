import type { PositionOutbox, QueuedPoint } from './positionOutbox';

// Esvazia a fila de posições em POST /positions/batch. Um ponto só sai da
// fila depois de o backend confirmar a página que o levou; repetir uma página
// é inofensivo (o backend pula a hora já gravada), perder uma não é.

/** O teto de pontos por requisição do backend (MAX_BATCH_POINTS). */
export const BATCH_PAGE_SIZE = 200;

export interface DrainResult {
  /** Pontos confirmados pelo backend nesta rodada. */
  sent: number;
  /** `empty`: nada a enviar. `failed`: parou numa falha e o resto ficou. */
  outcome: 'empty' | 'sent' | 'failed';
}

export interface PositionDrainer {
  /**
   * Manda os pontos do dono, página a página, na ordem. Se já há um dreno em
   * andamento, devolve o mesmo: duas rodadas juntas mandariam a mesma página.
   */
  drain(owner: string): Promise<DrainResult>;
}

interface DrainerDeps {
  outbox: PositionOutbox;
  send(points: readonly QueuedPoint[]): Promise<unknown>;
}

const statusOf = (error: unknown) =>
  (error as { status?: unknown } | null)?.status;

export function createPositionDrainer({ outbox, send }: DrainerDeps): PositionDrainer {
  let running: Promise<DrainResult> | null = null;

  async function run(owner: string): Promise<DrainResult> {
    const points = await outbox.pending(owner);
    if (points.length === 0) return { sent: 0, outcome: 'empty' };

    let sent = 0;
    for (let start = 0; start < points.length; start += BATCH_PAGE_SIZE) {
      const page = points.slice(start, start + BATCH_PAGE_SIZE);
      try {
        await send(page);
        sent += page.length;
      } catch (error) {
        // 400 é o contrato recusando a página: ela nunca vai passar, e
        // guardá-la travaria a fila para sempre. A fila já recusa ponto fora
        // do contrato na entrada, então isto é a exceção da exceção.
        if (statusOf(error) !== 400) return { sent, outcome: 'failed' };
        console.warn(`[positionDrain] ${page.length} pontos recusados pelo backend e descartados`);
      }
      await outbox.remove(
        owner,
        page.map((p) => p.recordedAt),
      );
    }
    return { sent, outcome: 'sent' };
  }

  return {
    drain(owner) {
      if (running) return running;
      running = run(owner).finally(() => {
        running = null;
      });
      return running;
    },
  };
}
