import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast } from '@kavicki/swi-design-system';
import { SendQueueRoot } from '../../../components/outbox/SendQueueRoot';
import type { SendQueueEvent } from '../../../services/outbox/sendQueue';
import type { SendItem } from '../../../services/outbox/sendOutbox';

// A raiz da fila de envios na área autenticada: liga a fila à sessão e mostra,
// por cima de qualquer tela, o aviso do envio que foi recusado.

const mockSession = jest.fn();
let mockEmit: (event: SendQueueEvent) => void = () => undefined;
jest.mock('../../../services/outbox/useSendQueue', () => ({
  useSendQueueSession: (userId: string) => mockSession(userId),
  useSendQueueEvent: (handler: (event: SendQueueEvent) => void) => {
    mockEmit = handler;
  },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const base = { id: 'i1', createdAt: '2026-10-04T12:00:00.000Z', images: [] };
const relatorio: SendItem = {
  ...base, kind: 'report', title: 'Inspeção', summary: '', details: '', responsibles: [],
};
const mensagem: SendItem = { ...base, id: 'i2', kind: 'chat.message', conversationId: 'a#b', body: 'oi' };

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SendQueueRoot userId="u1" />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const toasts = (tree: ReturnType<typeof create>) => tree.root.findAllByType(Toast);

beforeEach(() => {
  jest.clearAllMocks();
});

describe('SendQueueRoot', () => {
  it('liga a fila à sessão de quem está logado', () => {
    render();

    expect(mockSession).toHaveBeenCalledWith('u1');
  });

  it('sem recusa não mostra nada', () => {
    const tree = render();

    expect(toasts(tree)).toHaveLength(0);
  });

  it('envio confirmado não mostra aviso', () => {
    const tree = render();

    act(() => mockEmit({ type: 'sent', item: mensagem, result: {} }));

    expect(toasts(tree)).toHaveLength(0);
  });

  it('recusa do servidor vira Toast de erro que nomeia o que não foi enviado', () => {
    const tree = render();

    act(() => mockEmit({ type: 'refused', item: relatorio, reason: 'rejected' }));

    const [toast] = toasts(tree);
    expect(toast.props.variant).toBe('error');
    expect(toast.props.title).toBe('Não foi possível enviar o relatório "Inspeção".');
    expect(toast.props.message).toBe('O servidor recusou o envio.');
  });

  it('envio vencido diz que expirou', () => {
    const tree = render();

    act(() => mockEmit({ type: 'refused', item: mensagem, reason: 'expired' }));

    const [toast] = toasts(tree);
    expect(toast.props.title).toBe('Não foi possível enviar a mensagem.');
    expect(toast.props.message).toBe('O envio expirou depois de 3 dias sem conexão.');
  });

  it('uma recusa nova troca o aviso anterior', () => {
    const tree = render();

    act(() => mockEmit({ type: 'refused', item: relatorio, reason: 'rejected' }));
    act(() => mockEmit({ type: 'refused', item: mensagem, reason: 'rejected' }));

    expect(toasts(tree)).toHaveLength(1);
    expect(toasts(tree)[0].props.title).toBe('Não foi possível enviar a mensagem.');
  });

  it('fechar o Toast tira o aviso da tela', () => {
    const tree = render();
    act(() => mockEmit({ type: 'refused', item: relatorio, reason: 'rejected' }));

    act(() => toasts(tree)[0].props.onClose());

    expect(toasts(tree)).toHaveLength(0);
  });

  // O aviso flutua sobre a tela sem tirar o toque do que está embaixo.
  it('o aviso fica por cima da tela, abaixo da área segura do topo', () => {
    const tree = render();
    act(() => mockEmit({ type: 'refused', item: relatorio, reason: 'rejected' }));

    const moldura = tree.root.findAll(
      (n) => n.props?.testID === 'send-queue-refusal' && n.props?.pointerEvents === 'box-none',
    )[0];

    expect(moldura.props.style.position).toBe('absolute');
    expect(moldura.props.style.top).toBeGreaterThan(METRICS.insets.top);
  });
});
