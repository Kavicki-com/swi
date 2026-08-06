import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { EvacuationAckBar } from '../../components/EvacuationAckBar';
import type { ActiveEvacuationView } from '../../services/evacuation/types';

// Barra de confirmação de presença da evacuação real (Fase 2). Overlay do rodapé
// das telas de evacuação: só existe quando a org TEM evacuação ativa.
//
// O risco que estes testes cercam é o silêncio: sem evacuação ativa, e também
// quando a chamada de rede falha, a barra tem que desaparecer sem derrubar a
// tela da rota, que é a parte útil numa emergência. E o ack precisa ser
// disparado uma única vez por toque, com o erro visível quando não passa.

const mockGetActive = jest.fn();
const mockAck = jest.fn();
jest.mock('../../services/evacuation/getEvacuationBackend', () => ({
  getEvacuationBackend: () => ({
    getActive: mockGetActive,
    ack: mockAck,
    getRoute: jest.fn(),
  }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const ativa = (over: Partial<ActiveEvacuationView> = {}): ActiveEvacuationView => ({
  id: 'evac-1',
  total: 12,
  ackedCount: 3,
  myAck: false,
  ...over,
});

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <EvacuationAckBar />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const barra = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.testID === 'evacuation-ack-bar')[0];

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

// O Button do DS repassa onPress; pega o nó pressável do rótulo pedido.
const botao = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) =>
      typeof n.props?.onPress === 'function' &&
      n.findAll((c) => c.props?.children === label).length > 0,
  )[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockGetActive.mockResolvedValue(null);
  mockAck.mockResolvedValue(undefined);
});

describe('EvacuationAckBar — quando não deve aparecer', () => {
  it('sem evacuação ativa não renderiza nada', async () => {
    const tree = await render();
    expect(barra(tree)).toBeUndefined();
  });

  // Numa emergência a rota desenhada é o que importa; a barra é extra.
  it('se a consulta de evacuação ativa falha, a barra fica fora sem propagar erro', async () => {
    mockGetActive.mockRejectedValue(new Error('sem rede'));
    const tree = await render();
    expect(barra(tree)).toBeUndefined();
  });

  it('consulta o backend uma única vez por montagem', async () => {
    await render();
    expect(mockGetActive).toHaveBeenCalledTimes(1);
  });
});

describe('EvacuationAckBar — confirmação de presença', () => {
  it('com evacuação ativa e sem meu ack, oferece o CTA de confirmação', async () => {
    mockGetActive.mockResolvedValue(ativa());
    const tree = await render();

    expect(barra(tree)).toBeDefined();
    expect(textos(tree)).toContain('Confirmar chegada ao ponto de encontro');
  });

  it('quem já confirmou vê o estado confirmado, sem CTA', async () => {
    mockGetActive.mockResolvedValue(ativa({ myAck: true }));
    const tree = await render();

    const t = textos(tree);
    expect(t).toContain('Presença confirmada no ponto de encontro');
    expect(t).not.toContain('Confirmar chegada ao ponto de encontro');
  });

  it('o toque manda o ack com o id da evacuação ativa e troca para o confirmado', async () => {
    mockGetActive.mockResolvedValue(ativa());
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    expect(mockAck).toHaveBeenCalledWith('evac-1');
    expect(textos(tree)).toContain('Presença confirmada no ponto de encontro');
  });

  // Trava do duplo toque: `busy` existe pra isso, e o ack sai uma vez só.
  it('enquanto o ack está em voo mostra "Confirmando…" e ignora toques repetidos', async () => {
    mockGetActive.mockResolvedValue(ativa());
    let liberar!: () => void;
    mockAck.mockImplementation(() => new Promise<void>((res) => { liberar = res; }));
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    expect(textos(tree)).toContain('Confirmando…');

    await act(async () => { botao(tree, 'Confirmando…').props.onPress(); });
    expect(mockAck).toHaveBeenCalledTimes(1);

    await act(async () => { liberar(); });
    expect(textos(tree)).toContain('Presença confirmada no ponto de encontro');
  });
});

describe('EvacuationAckBar — ack que não passa', () => {
  it('mostra a mensagem do backend e mantém o CTA para tentar de novo', async () => {
    mockGetActive.mockResolvedValue(ativa());
    mockAck.mockRejectedValue(new Error('Evacuação já encerrada'));
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    const t = textos(tree);
    expect(t).toContain('Evacuação já encerrada');
    expect(t).toContain('Confirmar chegada ao ponto de encontro');
    expect(t).not.toContain('Presença confirmada no ponto de encontro');
  });

  it('rejeição que não é Error cai no texto genérico em vez de barra vazia', async () => {
    mockGetActive.mockResolvedValue(ativa());
    mockAck.mockRejectedValue(undefined);
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    expect(textos(tree)).toContain('Não foi possível confirmar');
  });

  // Comportamento nomeado, não corrigido: o fallback é `?? `, então uma mensagem
  // VAZIA ('') não é nulla e passa — o resultado é um ack falho sem aviso
  // nenhum na tela, só o CTA de volta. Nenhum backend nosso rejeita com
  // Error(''), mas o dia em que rejeitar, é isto que a pessoa vai ver.
  it('mensagem vazia não vira aviso: só o CTA volta', async () => {
    mockGetActive.mockResolvedValue(ativa());
    mockAck.mockRejectedValue(new Error(''));
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    const t = textos(tree);
    expect(t).not.toContain('Não foi possível confirmar');
    expect(t).toContain('Confirmar chegada ao ponto de encontro');
  });

  it('a nova tentativa limpa o erro anterior', async () => {
    mockGetActive.mockResolvedValue(ativa());
    mockAck.mockRejectedValueOnce(new Error('falhou uma vez')).mockResolvedValueOnce(undefined);
    const tree = await render();

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });
    expect(textos(tree)).toContain('falhou uma vez');

    await act(async () => {
      botao(tree, 'Confirmar chegada ao ponto de encontro').props.onPress();
    });

    const t = textos(tree);
    expect(t).not.toContain('falhou uma vez');
    expect(t).toContain('Presença confirmada no ponto de encontro');
  });
});
