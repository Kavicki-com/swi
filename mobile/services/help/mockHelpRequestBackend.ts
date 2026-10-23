import type { HelpRequestBackend, HelpRequestView } from './types';

// Pedido de ajuda em memória, para o app sem backend (demonstração e testes).
// Pedir abre um pedido aberto sem resgate, e pedir de novo devolve o mesmo,
// como o servidor faz. Ninguém atende: não há central do outro lado.
let current: HelpRequestView | null = null;
let seq = 0;

export const mockHelpRequestBackend: HelpRequestBackend = {
  async request() {
    if (current === null || current.status === 'CLOSED') {
      seq += 1;
      current = {
        id: `mock-help-${seq}`,
        status: 'OPEN',
        createdAt: new Date().toISOString(),
        attendedAt: null,
        closedAt: null,
        rescue: null,
      };
    }
    return { ...current };
  },
  async mine() {
    return current === null ? null : { ...current };
  },
  subscribe() {
    return () => {};
  },
};
