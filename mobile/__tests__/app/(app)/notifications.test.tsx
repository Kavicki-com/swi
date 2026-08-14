import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Notifications from '../../../app/(app)/notifications';
import type { AppNotification, NotificationDomain } from '../../../services/notifications/types';

// Lista de notificacoes. Duas coisas aqui sao contrato de navegacao e nao
// enfeite:
//
// 1. A tabela de dominio para rota. Cada card leva a UMA rota canonica; um
//    dominio sem entrada na tabela empurra `undefined` no router e a tela some
//    sem erro. O teste percorre os cinco dominios navegaveis, um a um.
// 2. 'weather' e o caso especial: marca lida, abre modal NO LUGAR e nao navega
//    A ausencia do push faz parte da afirmacao: navegar aqui tiraria a pessoa
//    da tela em que ela esta.
//
// As fronteiras dubladas sao o provider, o router e os dois modais. Os modais
// tem suite propria; aqui interessa QUEM os abre e fecha.

// --- Fronteiras dubladas -----------------------------------------------------

// O router e um objeto ESTAVEL, igual ao que o expo-router devolve. Um dublê
// que retorna `{ push }` novo a cada chamada quebra sozinho todo useCallback
// que depende dele, e o teste passaria a medir o dublê em vez da tela.
const mockPush = jest.fn();
const mockRouter = { push: mockPush, back: jest.fn() };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

let mockNotificacoesLigadas = true;
jest.mock('../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../lib/featureFlags'),
  isFeatureEnabled: (gate: string) => (gate === 'notifications' ? mockNotificacoesLigadas : true),
}));

const mockLoad = jest.fn();
const mockMarkRead = jest.fn();
const mockMarkAllRead = jest.fn();
let mockEstado: Record<string, unknown> = {};
jest.mock('../../../services/notifications/NotificationProvider', () => ({
  useNotifications: () => mockEstado,
}));

jest.mock('../../../components/NavFABs', () => ({ NavFABs: () => null }));

jest.mock('../../../components/modals/WeatherAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    WeatherAlertModal: (p: any) =>
      React.createElement(View, {
        testID: 'modal-clima',
        onClose: p.onClose,
        onPrimaryAction: p.onPrimaryAction,
      }),
  };
});
jest.mock('../../../components/modals/ActiveAlertModal', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    ActiveAlertModal: (p: any) =>
      React.createElement(View, {
        testID: 'modal-alerta-ativo',
        visible: p.visible,
        onClose: p.onClose,
      }),
  };
});

// --- Dados sinteticos --------------------------------------------------------

const notif = (over: Partial<AppNotification> = {}): AppNotification => ({
  id: 'n1',
  title: 'Mensagem da equipe',
  body: 'Voce tem uma nova mensagem no chat.',
  domain: 'chat',
  targetId: null,
  read: false,
  createdAt: '2026-08-01T12:00:00.000Z',
  ...over,
});

const estado = (over: Record<string, unknown> = {}) => ({
  myId: 'me',
  notifications: [] as AppNotification[],
  loadStatus: 'ready',
  unreadCount: 0,
  load: mockLoad,
  markRead: mockMarkRead,
  markAllRead: mockMarkAllRead,
  ...over,
});

// --- Helpers -----------------------------------------------------------------

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <Notifications />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Texto interpolado chega como array de children; achatar os dois casos e o que
// faz o teste ver o que o usuario ve.
const textoDa = (tree: ReactTestRenderer) => {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string' || typeof c === 'number') {
      pedacos.push(String(c));
    } else if (Array.isArray(c) && c.every((p) => typeof p === 'string' || typeof p === 'number')) {
      pedacos.push(c.join(''));
    }
  });
  return pedacos.join('\n');
};

const porRotulo = (tree: ReactTestRenderer, rotulo: string) =>
  tree.root.findAll(
    (n) => n.props?.accessibilityLabel === rotulo && typeof n.props?.onPress === 'function',
  )[0];

const porLabel = (tree: ReactTestRenderer, label: string) =>
  tree.root.findAll((n) => n.props?.label === label && typeof n.props?.onPress === 'function')[0];

const porTestID = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => n.props?.testID === id)[0];

// O card memoizado carrega a notificacao inteira nas props.
const cardDe = (tree: ReactTestRenderer, id: string) =>
  tree.root.findAll((n) => (n.props?.notif as AppNotification | undefined)?.id === id)[0];

const tocar = async (node: ReactTestInstance) => {
  await act(async () => {
    node.props.onPress();
  });
};

beforeEach(() => {
  jest.clearAllMocks();
  mockNotificacoesLigadas = true;
  mockEstado = estado();
});

// --- Gate --------------------------------------------------------------------

describe('Notificacoes: gate de build', () => {
  it('troca a lista pelo placeholder quando o gate esta desligado', async () => {
    mockNotificacoesLigadas = false;
    mockEstado = estado({ notifications: [notif()], unreadCount: 1 });

    const tree = await montar();

    expect(textoDa(tree)).not.toContain('Mensagem da equipe');
    expect(textoDa(tree)).toContain('Disponível na versão final');
  });
});

// --- Estados de carga --------------------------------------------------------

describe('Notificacoes: estados de carga', () => {
  it.each([
    ['loading', 'Carregando notificações…'],
    ['empty', 'Nenhuma notificação'],
    ['error', 'Não foi possível carregar'],
  ])('%s substitui a lista inteira pelo estado', async (status, texto) => {
    // A notificacao existe no provider: mesmo assim, o estado tem prioridade.
    mockEstado = estado({ loadStatus: status, notifications: [notif()], unreadCount: 1 });

    const tree = await montar();

    expect(textoDa(tree)).toContain(texto);
    expect(textoDa(tree)).not.toContain('Mensagem da equipe');
    expect(porLabel(tree, 'Marcar todas como lidas')).toBeUndefined();
  });

  it('o botao do estado de erro pede a carga de novo', async () => {
    mockEstado = estado({ loadStatus: 'error' });
    const tree = await montar();

    await tocar(porLabel(tree, 'Tentar novamente'));

    expect(mockLoad).toHaveBeenCalledTimes(1);
  });

  it.each(['idle', 'ready'])('%s desenha a lista, nao o estado', async (status) => {
    mockEstado = estado({ loadStatus: status, notifications: [notif()] });

    const tree = await montar();

    expect(textoDa(tree)).toContain('Notificações');
    expect(textoDa(tree)).toContain('Mensagem da equipe');
    expect(textoDa(tree)).not.toContain('Nenhuma notificação');
  });
});

// --- Lista -------------------------------------------------------------------

describe('Notificacoes: lista', () => {
  it('mostra titulo e corpo de cada notificacao', async () => {
    mockEstado = estado({
      notifications: [
        notif({
          id: 'a',
          title: 'Relatório aprovado',
          body: 'O relatório 12 foi aprovado.',
          domain: 'reports',
        }),
        notif({ id: 'b', title: 'Nova tarefa', body: 'Inspeção da correia 4.', domain: 'journey' }),
      ],
    });

    const texto = textoDa(await montar());

    expect(texto).toContain('Relatório aprovado');
    expect(texto).toContain('O relatório 12 foi aprovado.');
    expect(texto).toContain('Nova tarefa');
    expect(texto).toContain('Inspeção da correia 4.');
  });

  it('anuncia a nao lida no rotulo e deixa a lida sem sufixo', async () => {
    mockEstado = estado({
      notifications: [
        notif({ id: 'a', title: 'Nova', read: false }),
        notif({ id: 'b', title: 'Velha', read: true }),
      ],
      unreadCount: 1,
    });

    const tree = await montar();

    expect(porRotulo(tree, 'Nova (não lida)')).toBeDefined();
    expect(porRotulo(tree, 'Velha')).toBeDefined();
    expect(porRotulo(tree, 'Velha (não lida)')).toBeUndefined();
  });

  it('so oferece marcar todas quando ainda existe nao lida', async () => {
    mockEstado = estado({ notifications: [notif({ read: true })], unreadCount: 0 });
    expect(porLabel(await montar(), 'Marcar todas como lidas')).toBeUndefined();

    mockEstado = estado({ notifications: [notif()], unreadCount: 1 });
    expect(porLabel(await montar(), 'Marcar todas como lidas')).toBeDefined();
  });

  it('marcar todas delega ao provider, sem navegar', async () => {
    mockEstado = estado({ notifications: [notif()], unreadCount: 1 });
    const tree = await montar();

    await tocar(porLabel(tree, 'Marcar todas como lidas'));

    expect(mockMarkAllRead).toHaveBeenCalledTimes(1);
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// --- Roteamento por dominio --------------------------------------------------

describe('Notificacoes: roteamento por dominio', () => {
  it.each([
    ['chat', '/(app)/chat/inbox'],
    ['reports', '/(app)/reports'],
    ['journey', '/(app)/journey'],
    ['faq', '/(app)/settings/faq'],
    ['evacuation', '/(app)/evacuation'],
  ])('%s marca lida e abre %s', async (dominio, rota) => {
    mockEstado = estado({
      notifications: [notif({ id: 'alvo', title: 'Alvo', domain: dominio as NotificationDomain })],
      unreadCount: 1,
    });
    const tree = await montar();

    await tocar(porRotulo(tree, 'Alvo (não lida)'));

    expect(mockMarkRead).toHaveBeenCalledWith('alvo');
    expect(mockPush).toHaveBeenCalledTimes(1);
    expect(mockPush).toHaveBeenCalledWith(rota);
    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('weather marca lida, abre o modal no lugar e NAO troca de tela (R-5)', async () => {
    mockEstado = estado({
      notifications: [notif({ id: 'w', title: 'Tempestade', domain: 'weather' })],
      unreadCount: 1,
    });
    const tree = await montar();

    await tocar(porRotulo(tree, 'Tempestade (não lida)'));

    expect(mockMarkRead).toHaveBeenCalledWith('w');
    expect(mockPush).not.toHaveBeenCalled();
    expect(porTestID(tree, 'modal-clima')).toBeDefined();
  });

  it('o icone de opcoes leva ao mesmo destino do card', async () => {
    mockEstado = estado({ notifications: [notif({ id: 'a', title: 'Alvo' })], unreadCount: 1 });
    const tree = await montar();

    await tocar(porRotulo(tree, 'Opções para Alvo'));

    expect(mockMarkRead).toHaveBeenCalledWith('a');
    expect(mockPush).toHaveBeenCalledWith('/(app)/chat/inbox');
  });

  it('notificacao que sumiu da lista entre o render e o toque nao navega', async () => {
    mockEstado = estado({ notifications: [notif({ id: 'a', title: 'Alvo' })], unreadCount: 1 });
    const tree = await montar();

    await act(async () => {
      cardDe(tree, 'a').props.onPress('id-que-nao-existe-mais');
    });

    expect(mockMarkRead).not.toHaveBeenCalled();
    expect(mockPush).not.toHaveBeenCalled();
  });
});

// --- Modais sobrepostos ------------------------------------------------------

describe('Notificacoes: modais sobrepostos', () => {
  const comWeather = () =>
    estado({
      notifications: [notif({ id: 'w', title: 'Tempestade', domain: 'weather' })],
      unreadCount: 1,
    });

  const abrirClima = async (tree: ReactTestRenderer) => {
    await tocar(porRotulo(tree, 'Tempestade (não lida)'));
  };

  it('nenhum modal nasce aberto', async () => {
    mockEstado = comWeather();
    const tree = await montar();

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(false);
  });

  it('tocar no fundo fecha o alerta meteorologico', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);

    await tocar(porRotulo(tree, 'Fechar alerta meteorológico'));

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('tocar dentro do cartao nao fecha o alerta meteorologico', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);

    const dentro = tree.root.findAll(
      (n) => n.props?.style?.width === '100%' && typeof n.props?.onPress === 'function',
    )[0];
    await tocar(dentro);

    expect(porTestID(tree, 'modal-clima')).toBeDefined();
  });

  it('o voltar do Android fecha o alerta meteorologico', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);

    // onRequestClose e o unico caminho do botao fisico: sem ele, o modal fica
    // preso e o usuario nao consegue voltar para a lista.
    const modal = tree.root.findAll((n) => typeof n.props?.onRequestClose === 'function')[0];
    await act(async () => {
      modal.props.onRequestClose();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  // A tela liga um onClose no WeatherAlertModal, mas o componente real declara
  // a prop e nunca a chama (WeatherAlertModal.tsx:35, sem uso no corpo). Hoje
  // quem fecha e o fundo. O teste afirma que a ligacao da tela FUNCIONA, para o
  // dia em que o modal ganhar um X proprio; ele nao afirma que alguem a dispara.
  it('a ligacao de fechar entregue ao modal do clima realmente fecha', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onClose();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
  });

  it('o CTA do clima troca um modal pelo outro, sem passar pelo dashboard', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);

    await act(async () => {
      porTestID(tree, 'modal-clima').props.onPrimaryAction();
    });

    expect(porTestID(tree, 'modal-clima')).toBeUndefined();
    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(true);
    expect(mockPush).not.toHaveBeenCalled();
  });

  it('fechar o alerta ativo devolve a lista', async () => {
    mockEstado = comWeather();
    const tree = await montar();
    await abrirClima(tree);
    await act(async () => {
      porTestID(tree, 'modal-clima').props.onPrimaryAction();
    });

    await act(async () => {
      porTestID(tree, 'modal-alerta-ativo').props.onClose();
    });

    expect(porTestID(tree, 'modal-alerta-ativo').props.visible).toBe(false);
    expect(textoDa(tree)).toContain('Tempestade');
  });
});

// --- Estabilidade dos cards (T4.4) -------------------------------------------

describe('Notificacoes: estabilidade dos cards', () => {
  it('o handler dos cards nao muda de identidade quando um modal abre', async () => {
    mockEstado = estado({
      notifications: [
        notif({ id: 'w', title: 'Tempestade', domain: 'weather' }),
        notif({ id: 'a', title: 'Alvo' }),
      ],
      unreadCount: 2,
    });
    const tree = await montar();
    const antes = cardDe(tree, 'a').props.onPress;

    await tocar(porRotulo(tree, 'Tempestade (não lida)'));

    // Sem o useCallback, abrir o modal trocaria a prop e o memo do card cairia.
    expect(porTestID(tree, 'modal-clima')).toBeDefined();
    expect(cardDe(tree, 'a').props.onPress).toBe(antes);
  });
});
