import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider, Toast } from '@kavicki/swi-design-system';
import { SendQueueRoot } from '../../../components/outbox/SendQueueRoot';
import { OFFLINE_PENDING_TITLE, OFFLINE_TITLE } from '../../../services/outbox/sendCopy';
import type { SendQueueEvent, SendQueueState } from '../../../services/outbox/sendQueue';
import type { SendItem } from '../../../services/outbox/sendOutbox';
import type { MyTelemetryState } from '../../../services/vitals/MyTelemetryProvider';
import { reporting } from '../../../services/telemetry/myTelemetryFixtures';

// A raiz da fila de envios na área autenticada: liga a fila à sessão e mostra,
// por cima de qualquer tela, um aviso por vez: o envio que foi recusado, a
// falta de conexão e a bateria baixa do relógio.

const mockSession = jest.fn();
let mockEmit: (event: SendQueueEvent) => void = () => undefined;
let mockQueueState: SendQueueState = { items: [], refused: [], open: true, stalled: false };
jest.mock('../../../services/outbox/useSendQueue', () => ({
  useSendQueueSession: (userId: string) => mockSession(userId),
  useSendQueueEvent: (handler: (event: SendQueueEvent) => void) => {
    mockEmit = handler;
  },
  useSendQueueState: () => mockQueueState,
}));
let mockOffline = false;
jest.mock('../../../services/realtime/useConnection', () => ({
  useConnectionLost: () => mockOffline,
}));
let mockTelemetry: MyTelemetryState = { telemetry: null, failed: false, loading: false };
jest.mock('../../../services/vitals/MyTelemetryProvider', () => ({
  useMyTelemetry: () => mockTelemetry,
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

const arvore = () => (
  <SafeAreaProvider initialMetrics={METRICS}>
    <SwiThemeProvider>
      <SendQueueRoot userId="u1" />
    </SwiThemeProvider>
  </SafeAreaProvider>
);

const render = () => {
  let tree!: ReturnType<typeof create>;
  act(() => {
    tree = create(arvore());
  });
  return tree;
};

/** Muda o que os dublês devolvem e desenha de novo. */
const mudar = (
  tree: ReturnType<typeof create>,
  over: { offline?: boolean; stalled?: boolean; telemetry?: MyTelemetryState['telemetry'] },
) => {
  if (over.offline !== undefined) mockOffline = over.offline;
  if (over.stalled !== undefined) mockQueueState = { ...mockQueueState, stalled: over.stalled };
  if (over.telemetry !== undefined) mockTelemetry = { ...mockTelemetry, telemetry: over.telemetry };
  act(() => tree.update(arvore()));
};

const toasts = (tree: ReturnType<typeof create>) => tree.root.findAllByType(Toast);
const fechar = (tree: ReturnType<typeof create>) => act(() => toasts(tree)[0].props.onClose());

const bateriaBaixa = (openedAt = '2026-10-05T12:00:00.000Z', observedValue: number | null = 12) => ({
  ...reporting(),
  conditions: [
    { kind: 'DEVICE_BATTERY_LOW', category: 'DEVICE' as const, openedAt, observedValue, thresholdValue: 15 },
  ],
});

beforeEach(() => {
  jest.clearAllMocks();
  mockQueueState = { items: [], refused: [], open: true, stalled: false };
  mockOffline = false;
  mockTelemetry = { telemetry: null, failed: false, loading: false };
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
      (n) => n.props?.testID === 'send-queue-notice' && n.props?.pointerEvents === 'box-none',
    )[0];

    expect(moldura.props.style.position).toBe('absolute');
    expect(moldura.props.style.top).toBeGreaterThan(METRICS.insets.top);
  });
});

describe('SendQueueRoot: sem conexão', () => {
  it('sem envio parado, avisa que a tela pode estar desatualizada', () => {
    const tree = render();
    mudar(tree, { offline: true });

    const [toast] = toasts(tree);
    expect(toast.props.variant).toBe('warning');
    expect(toast.props.title).toBe(OFFLINE_TITLE);
    expect(toast.props.message).toBeUndefined();
  });

  it('com envio parado, avisa que as ações saem quando o sinal voltar', () => {
    const tree = render();
    mudar(tree, { offline: true, stalled: true });

    expect(toasts(tree)[0].props.title).toBe(OFFLINE_PENDING_TITLE);
  });

  it('a conexão que volta tira o aviso', () => {
    const tree = render();
    mudar(tree, { offline: true });
    mudar(tree, { offline: false });

    expect(toasts(tree)).toHaveLength(0);
  });

  it('a recusa vem antes; fechada, aparece a falta de conexão', () => {
    const tree = render();
    mudar(tree, { offline: true });
    act(() => mockEmit({ type: 'refused', item: relatorio, reason: 'rejected' }));

    expect(toasts(tree)).toHaveLength(1);
    expect(toasts(tree)[0].props.variant).toBe('error');

    fechar(tree);
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_TITLE);
  });

  it('fechado, não volta durante a mesma queda, e volta na queda seguinte', () => {
    const tree = render();
    mudar(tree, { offline: true });
    fechar(tree);
    mudar(tree, { offline: true });
    expect(toasts(tree)).toHaveLength(0);

    mudar(tree, { offline: false });
    mudar(tree, { offline: true });
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_TITLE);
  });

  it('fechado o aviso sem envio, o envio que fica parado ainda avisa', () => {
    const tree = render();
    mudar(tree, { offline: true });
    fechar(tree);

    mudar(tree, { stalled: true });
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_PENDING_TITLE);
  });

  it('fechado o aviso dos envios, volta só depois de a fila andar e parar de novo', () => {
    const tree = render();
    mudar(tree, { offline: true, stalled: true });
    fechar(tree);
    mudar(tree, { offline: true, stalled: true });
    expect(toasts(tree)).toHaveLength(0);

    // A fila andou (ou esvaziou); o socket segue caído.
    mudar(tree, { stalled: false });
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_TITLE);

    mudar(tree, { stalled: true });
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_PENDING_TITLE);
  });
});

describe('SendQueueRoot: bateria do relógio', () => {
  it('condição aberta vira aviso com o texto da notificação do servidor', () => {
    const tree = render();
    mudar(tree, { telemetry: bateriaBaixa() });

    const [toast] = toasts(tree);
    expect(toast.props.variant).toBe('warning');
    expect(toast.props.title).toBe('Bateria do relógio baixa');
    expect(toast.props.message).toBe('Bateria em 12%. Carregue o relógio para seguir monitorado.');
  });

  it('sem a condição, sem aviso', () => {
    const tree = render();
    mudar(tree, { telemetry: reporting() });

    expect(toasts(tree)).toHaveLength(0);
  });

  it('a falta de conexão vem antes da bateria', () => {
    const tree = render();
    mudar(tree, { offline: true, telemetry: bateriaBaixa() });

    expect(toasts(tree)).toHaveLength(1);
    expect(toasts(tree)[0].props.title).toBe(OFFLINE_TITLE);
  });

  it('fechado, some enquanto a mesma condição seguir aberta, e volta quando ela reabre', () => {
    const tree = render();
    mudar(tree, { telemetry: bateriaBaixa() });
    fechar(tree);
    mudar(tree, { telemetry: bateriaBaixa() });
    expect(toasts(tree)).toHaveLength(0);

    mudar(tree, { telemetry: bateriaBaixa('2026-10-05T15:00:00.000Z', 14) });
    expect(toasts(tree)[0].props.message).toBe('Bateria em 14%. Carregue o relógio para seguir monitorado.');
  });
});
