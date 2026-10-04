import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ChatUserInfo from '../../../../app/(app)/chat/user-info';
import type { Contact } from '../../../../services/chat/types';
import type { Colleague, ColleagueStatus } from '../../../../services/positions/types';

// Ficha do contato aberta a partir do chat (app/(app)/chat/user-info.tsx).
//
// A ficha mostrava uma barra de fadiga com percentual e tempo calculados a
// partir do id do colega, ao lado da identidade real dele. O que o app sabe de
// verdade sobre a saúde de um colega é só o estado, o mesmo que o mapa pinta
// no pino: é isso que a ficha mostra, e nenhum número.

let mockParams: { userId?: string } = { userId: 'w1' };
jest.mock('expo-router', () => ({
  useRouter: () => ({ push: jest.fn(), back: jest.fn() }),
  useLocalSearchParams: () => mockParams,
}));

const mockChat = { directory: [] as Contact[] };
jest.mock('../../../../services/chat/ChatProvider', () => ({ useChat: () => mockChat }));

const mockListColleagues = jest.fn();
jest.mock('../../../../services/positions/getPositionsBackend', () => ({
  getPositionsBackend: () => ({ listColleagues: () => mockListColleagues() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const contato = (over: Partial<Contact> = {}): Contact => ({
  workerId: 'w1',
  name: 'Ana Souza',
  sector: 'Setor Leste',
  role: 'Operadora',
  avatarUri: 'https://example.test/w1.png',
  ...over,
});

const colega = (status: ColleagueStatus, id = 'w1'): Colleague => ({
  id,
  name: 'Ana Souza',
  lat: -23.5,
  lng: -46.6,
  sector: 'Setor Leste',
  avatar: '',
  recordedAt: '2026-08-06T13:05:00.000Z',
  status,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ChatUserInfo />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

let montada: ReturnType<typeof create> | null = null;
const abrir = async () => {
  montada = await render();
  return montada;
};

beforeEach(() => {
  jest.useFakeTimers();
  mockParams = { userId: 'w1' };
  mockChat.directory = [contato()];
  mockListColleagues.mockReset();
  mockListColleagues.mockResolvedValue([colega('good')]);
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
});

describe('ficha do contato: sem fadiga inventada', () => {
  it('não mostra barra nem tempo até a fadiga do colega', async () => {
    const tree = await abrir();

    expect(textos(tree)).not.toContain('Tempo até a fadiga total');
    expect(tree.root.findAll((n) => n.props?.accessibilityLabel === 'Tempo até fadiga')).toHaveLength(0);
    expect(textos(tree).some((t) => /^\d+h\d{2}m$/.test(t))).toBe(false);
  });
});

describe('ficha do contato: estado do colega', () => {
  it.each([
    ['good', 'Bom'],
    ['alert', 'Alerta'],
    ['low', 'Urgente'],
    ['unknown', 'Sem leitura'],
  ] as const)('estado %s do backend aparece como "%s"', async (status, rotulo) => {
    mockListColleagues.mockResolvedValue([colega('good', 'w2'), colega(status)]);
    const tree = await abrir();

    expect(textos(tree)).toContain('Estado atual');
    expect(textos(tree)).toContain(rotulo);
  });

  // A rota só lista quem tem posição recente. Quem ficou de fora não é "bom":
  // ninguém leu o estado dele.
  it('colega fora da lista fica sem leitura, nunca como bom', async () => {
    mockListColleagues.mockResolvedValue([colega('good', 'w2')]);
    const tree = await abrir();

    expect(textos(tree)).toContain('Sem leitura');
    expect(textos(tree)).not.toContain('Bom');
  });

  it('antes da resposta diz que está carregando, sem afirmar estado', async () => {
    mockListColleagues.mockReturnValue(new Promise(() => {}));
    const tree = await abrir();

    expect(textos(tree)).toContain('Carregando');
    expect(textos(tree)).not.toContain('Sem leitura');
  });

  it('falha na leitura não vira ausência de leitura do colega', async () => {
    mockListColleagues.mockRejectedValue(new Error('offline'));
    const tree = await abrir();

    expect(textos(tree)).toContain('Indisponível no momento');
    expect(textos(tree)).not.toContain('Sem leitura');
  });

  // O título diz "atual": estado que ninguém consegue mais confirmar não
  // pode continuar embaixo dele.
  it('releitura que falha tira o estado anterior da tela', async () => {
    const tree = await abrir();
    expect(textos(tree)).toContain('Bom');

    mockListColleagues.mockRejectedValue(new Error('offline'));
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    expect(textos(tree)).toContain('Indisponível no momento');
    expect(textos(tree)).not.toContain('Bom');
  });

  it('diretório que chega depois de a ficha abrir liga a leitura', async () => {
    mockChat.directory = [];
    const tree = await abrir();
    expect(mockListColleagues).not.toHaveBeenCalled();

    mockChat.directory = [contato()];
    await act(async () => {
      tree.update(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SwiThemeProvider>
            <ChatUserInfo />
          </SwiThemeProvider>
        </SafeAreaProvider>,
      );
    });

    expect(textos(tree)).toContain('Bom');
  });

  it('o estado acompanha a releitura', async () => {
    const tree = await abrir();
    expect(textos(tree)).toContain('Bom');

    mockListColleagues.mockResolvedValue([colega('low')]);
    await act(async () => {
      jest.advanceTimersByTime(15_000);
    });

    expect(textos(tree)).toContain('Urgente');
  });

  it('contato que não existe no diretório não dispara leitura', async () => {
    mockParams = { userId: 'ninguem' };
    const tree = await abrir();

    expect(mockListColleagues).not.toHaveBeenCalled();
    expect(textos(tree)).not.toContain('Estado atual');
  });
});
