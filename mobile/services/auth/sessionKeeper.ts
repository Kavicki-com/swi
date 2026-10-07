import type { SessionCheck, User } from './types';

// Quem pergunta de novo ao servidor se a sessão aberta ainda vale. Não conhece
// React, AppState nem socket: o AuthProvider liga os gatilhos (a conexão que
// volta, o primeiro plano, um 401) ao `trigger`.
//
// Sessão aberta pela cópia, sem o servidor ter confirmado, também tenta
// sozinha a cada 30 s, até a primeira resposta.

/** Intervalo entre tentativas enquanto a sessão não foi confirmada. */
export const CONFIRM_RETRY_MS = 30_000;

export interface SessionKeeperDeps {
  confirm(): Promise<SessionCheck>;
  onValid(user: User): void;
  /** O servidor recusou o token, ou ele sumiu: a sessão acabou. */
  onRevoked(): void;
}

export interface SessionKeeper {
  /**
   * Passa a acompanhar uma sessão aberta. `confirmed`: o servidor já confirmou
   * nesta abertura. `inFlight`: confirmação que já está no ar e vale como a
   * primeira tentativa.
   */
  start(confirmed: boolean, inFlight?: Promise<SessionCheck>): void;
  /** Confirma agora; durante outra confirmação, vira uma só, depois dela. */
  trigger(): void;
  /**
   * Confirma agora só se o servidor ainda não confirmou: a conexão que volta e
   * o primeiro plano não perguntam de novo por uma sessão já confirmada.
   */
  retry(): void;
  /** Para de acompanhar; resposta que chegar depois é descartada. */
  stop(): void;
}

export function createSessionKeeper(
  deps: SessionKeeperDeps,
  retryMs: number = CONFIRM_RETRY_MS,
): SessionKeeper {
  // Muda a cada start e stop: resposta de antes disso não vale mais.
  let session = 0;
  let active = false;
  let running = false;
  let again = false;
  let confirmed = false;
  let timer: ReturnType<typeof setInterval> | null = null;

  const stopTimer = () => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };

  function stop() {
    session += 1;
    active = false;
    running = false;
    again = false;
    stopTimer();
  }

  function settle(mine: number, check: SessionCheck) {
    if (mine !== session) return;
    if (check.status === 'valid') {
      confirmed = true;
      stopTimer();
      deps.onValid(check.user);
    } else if (check.status === 'revoked' || check.status === 'none') {
      stop();
      deps.onRevoked();
    }
  }

  function follow(mine: number, work: Promise<SessionCheck>) {
    running = true;
    // Rejeição não é resposta do servidor: conta como sem resposta.
    work
      .then((check) => settle(mine, check), () => undefined)
      .finally(() => {
        if (mine !== session) return;
        running = false;
        if (again) {
          again = false;
          run();
        }
      });
  }

  function run() {
    if (!active) return;
    if (running) {
      again = true;
      return;
    }
    // O executor roda na hora; exceção do confirm vira rejeição.
    follow(session, new Promise<SessionCheck>((resolve) => resolve(deps.confirm())));
  }

  return {
    start(alreadyConfirmed, inFlight) {
      stop();
      active = true;
      confirmed = alreadyConfirmed;
      if (!confirmed) timer = setInterval(run, retryMs);
      if (inFlight) follow(session, inFlight);
    },
    trigger: run,
    retry() {
      if (!confirmed) run();
    },
    stop,
  };
}
