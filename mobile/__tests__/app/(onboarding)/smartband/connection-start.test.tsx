import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import SmartbandConnectionStart from '../../../../app/(onboarding)/smartband/connection-start';
import { isFeatureEnabled } from '../../../../lib/featureFlags';

// Figma 215:17901. A tela é um relógio 3D girando enquanto uma barra de
// sincronização enche sozinha; quando ela enche, a tela troca de rota. Tudo
// aqui é tempo: o tique de 100ms, o teto em 1 e a espera de 400ms.
//
// Nada disso era exercitado porque a tela inteira vive atrás do portão
// `smartbandOnboarding`, que é falso em Expo Go e em teste. Sem ligar o portão
// à mão, o que monta é o placeholder de build de produção.

// O router entra na lista de dependências do efeito que agenda a navegação
// ([progress, router]). Um objeto novo a cada render reagendaria a espera a
// cada tique, e o teste passaria a medir o dublê em vez da tela.
const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace, back: jest.fn(), canGoBack: () => true };
jest.mock('expo-router', () => ({ useRouter: () => mockRouter }));

// Mock parcial: DATA_BACKEND, AUTH_BACKEND e o resto do módulo seguem valendo
// de verdade; só o portão desta tela fica sob controle do teste.
jest.mock('../../../../lib/featureFlags', () => ({
  ...jest.requireActual('../../../../lib/featureFlags'),
  isFeatureEnabled: jest.fn(),
}));

// Fronteira: o visualizador baixa um .glb de ~4MB e roda WebGL, e tem suíte
// própria em components/Smartwatch3D. Aqui vira uma View que carrega os
// próprios props pra inspeção.
jest.mock('../../../../components/Smartwatch3D', () => {
  const React = require('react');
  const { View } = require('react-native');
  return {
    Smartwatch3D: (p: Record<string, unknown>) =>
      React.createElement(View, { testID: 'smartwatch-3d', ...p }),
  };
});

const mockIsFeatureEnabled = isFeatureEnabled as jest.Mock;

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SmartbandConnectionStart />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const avancar = async (ms: number) => {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
};

// Quem recebe o progresso é o SmartbandStatus do DS. O `message` distingue o
// componente de qualquer nó interno que só repasse o número adiante.
const progresso = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => typeof n.props?.progress === 'number' && typeof n.props?.message === 'string',
  )[0].props.progress as number;

const relogio3d = (tree: ReturnType<typeof create>) =>
  tree.root.findAll((n) => n.props?.testID === 'smartwatch-3d');

beforeEach(() => {
  jest.useFakeTimers();
  mockReplace.mockClear();
  mockIsFeatureEnabled.mockReturnValue(true);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Smartband, portão de recurso', () => {
  // Sem o portão, uma build sem os recursos nativos abriria a tela do relógio
  // 3D e pararia ali: a sincronização depende de BLE que não existe.
  it('em build sem o recurso, mostra o aviso e não monta o visualizador 3D', async () => {
    mockIsFeatureEnabled.mockReturnValue(false);

    const tree = await render();

    expect(relogio3d(tree)).toHaveLength(0);
    expect(JSON.stringify(tree.toJSON())).toContain('Disponível na versão final');
  });

  it('o portão consultado é o do onboarding da smartband', async () => {
    await render();

    expect(mockIsFeatureEnabled).toHaveBeenCalledWith('smartbandOnboarding');
  });

  it('com o recurso ligado, monta o visualizador e a barra zerada', async () => {
    const tree = await render();

    expect(relogio3d(tree).length).toBeGreaterThan(0);
    expect(progresso(tree)).toBe(0);
  });
});

describe('Smartband, barra de sincronização', () => {
  it('anda um trinta avos a cada 100ms', async () => {
    const tree = await render();

    await avancar(100);

    expect(progresso(tree)).toBeCloseTo(1 / 30, 10);
  });

  it('em 1 segundo já andou dez tiques', async () => {
    const tree = await render();

    await avancar(1000);

    expect(progresso(tree)).toBeCloseTo(10 / 30, 10);
  });

  // Comportamento que o teste NOMEIA, não corrige: somar 100/3000 trinta vezes
  // dá 0.9999999999999999, não 1. A sincronização anunciada como de 3 segundos
  // leva 3,1: precisa de um tique a mais porque o trigésimo não fecha a conta.
  it('aos 3000ms exatos a barra ainda não fechou; ela fecha no tique seguinte', async () => {
    const tree = await render();

    await avancar(3000);
    expect(progresso(tree)).toBeLessThan(1);

    await avancar(100);
    expect(progresso(tree)).toBe(1);
  });

  // Math.min é o que segura. Sem ele a barra passaria de 1 e o DS receberia um
  // progresso fora da faixa enquanto os 400ms da saída não vencem.
  it('a barra para em 1 e não passa disso, por mais que o tempo corra', async () => {
    const tree = await render();

    await avancar(10000);

    expect(progresso(tree)).toBe(1);
  });
});

describe('Smartband, troca de rota no fim', () => {
  it('não troca de tela enquanto a barra não enche', async () => {
    await render();

    await avancar(2900);

    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('depois de encher, espera 400ms antes de trocar de tela', async () => {
    await render();

    await avancar(3100);
    expect(mockReplace).not.toHaveBeenCalled();

    await avancar(399);
    expect(mockReplace).not.toHaveBeenCalled();

    await avancar(1);
    expect(mockReplace).toHaveBeenCalledWith('/(onboarding)/smartband/complete');
  });
});

describe('Smartband, sair no meio', () => {
  // A contagem global de timers não serve de prova: a árvore agenda outros.
  // Estes dois testes seguem o id, do agendamento até o cancelamento.
  it('sair da tela para o relógio da barra', async () => {
    const agendar = jest.spyOn(globalThis, 'setInterval');
    const cancelar = jest.spyOn(globalThis, 'clearInterval');

    const tree = await render();
    const idsDoTique = agendar.mock.calls
      .map((args, i) => (args[1] === 100 ? agendar.mock.results[i].value : undefined))
      .filter((v) => v !== undefined);
    expect(idsDoTique).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });

    expect(cancelar).toHaveBeenCalledWith(idsDoTique[0]);
  });

  it('sair depois de encher cancela a troca de rota agendada', async () => {
    const agendar = jest.spyOn(globalThis, 'setTimeout');
    const cancelar = jest.spyOn(globalThis, 'clearTimeout');

    const tree = await render();
    await avancar(3100);

    const idsDaEspera = agendar.mock.calls
      .map((args, i) => (args[1] === 400 ? agendar.mock.results[i].value : undefined))
      .filter((v) => v !== undefined);
    expect(idsDaEspera).toHaveLength(1);

    await act(async () => {
      tree.unmount();
    });
    expect(cancelar).toHaveBeenCalledWith(idsDaEspera[0]);

    // A prova que importa: sem o cancelamento, deixar o tempo correr levaria a
    // pessoa pra outra tela depois de ela já ter saído desta.
    await avancar(1000);
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
