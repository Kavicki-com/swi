import { HELP_COPY, helpNotice } from './helpCopy';
import type { HelpRequestView } from './types';

// A faixa de estado do pedido dentro do procedimento. Ela não pode afirmar o
// que não aconteceu: sem envio confirmado não há "enviado", e sem socorrista
// despachado não há "a caminho".

const pedido = (over: Partial<HelpRequestView> = {}): HelpRequestView => ({
  id: 'h1',
  status: 'OPEN',
  createdAt: '2026-10-22T12:00:00.000Z',
  attendedAt: null,
  closedAt: null,
  rescue: null,
  ...over,
});

const resgate = (status: 'dispatched' | 'arrived' | 'ended') => ({
  id: 'r1',
  status,
  dispatchedAt: '2026-10-22T12:01:00.000Z',
  arrivedAt: null,
  rescuerPosition: null,
});

const estado = (over: Partial<Parameters<typeof helpNotice>[0]> = {}) => ({
  helpRequest: null,
  sending: false,
  failed: false,
  ...over,
});

describe('helpNotice', () => {
  it('sem pedido e sem envio: nenhuma faixa', () => {
    expect(helpNotice(estado())).toBeNull();
  });

  it('enviando', () => {
    expect(helpNotice(estado({ sending: true }))).toEqual({
      variant: 'info',
      title: HELP_COPY.sending,
      retry: false,
    });
  });

  // A falha vale acima de um pedido anterior: a pessoa tocou de novo e o
  // toque não chegou, e é isso que ela precisa saber.
  it('falhou: erro com nova tentativa, mesmo com pedido anterior', () => {
    const notice = helpNotice(estado({ failed: true, helpRequest: pedido({ status: 'CLOSED' }) }));
    expect(notice).toEqual({ variant: 'error', title: HELP_COPY.failed, retry: true });
  });

  it('nova tentativa em curso depois da falha mostra o envio, sem botão', () => {
    expect(helpNotice(estado({ failed: true, sending: true }))?.retry).toBe(false);
  });

  it('aberto: enviado', () => {
    expect(helpNotice(estado({ helpRequest: pedido() }))).toEqual({
      variant: 'success',
      title: HELP_COPY.sent,
      retry: false,
    });
  });

  it('atendido sem resgate: a central recebeu', () => {
    const notice = helpNotice(estado({ helpRequest: pedido({ status: 'ATTENDED' }) }));
    expect(notice?.title).toBe(HELP_COPY.attended);
  });

  it('socorrista despachado: a caminho', () => {
    const notice = helpNotice(
      estado({ helpRequest: pedido({ status: 'ATTENDED', rescue: resgate('dispatched') }) }),
    );
    expect(notice?.title).toBe(HELP_COPY.rescuerOnTheWay);
  });

  it('socorrista no local', () => {
    const notice = helpNotice(
      estado({ helpRequest: pedido({ status: 'ATTENDED', rescue: resgate('arrived') }) }),
    );
    expect(notice?.title).toBe(HELP_COPY.rescuerArrived);
  });

  it('encerrado: nenhuma faixa', () => {
    expect(helpNotice(estado({ helpRequest: pedido({ status: 'CLOSED' }) }))).toBeNull();
  });
});
