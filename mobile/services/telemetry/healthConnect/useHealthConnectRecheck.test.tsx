import { AppState, type AppStateStatus } from 'react-native';
import { act, create } from 'react-test-renderer';
import { useHealthConnectRecheck } from './useHealthConnectRecheck';

// A conferência do Health Connect ao entrar e a cada volta ao primeiro plano,
// comum ao passo do pareamento e ao Monitoramento: a volta da Play Store ou
// dos ajustes é onde a pessoa pode ter instalado, concedido ou revogado.

const ouvirAppState = () => {
  const ouvintes: ((estado: AppStateStatus) => void)[] = [];
  const remover = jest.fn();
  jest.spyOn(AppState, 'addEventListener').mockImplementation((_tipo, ouvinte) => {
    ouvintes.push(ouvinte as (estado: AppStateStatus) => void);
    return { remove: remover } as unknown as ReturnType<typeof AppState.addEventListener>;
  });
  return {
    remover,
    mudar: async (estado: AppStateStatus) => {
      await act(async () => {
        ouvintes.forEach((ouvinte) => ouvinte(estado));
      });
    },
  };
};

function Tela({ conferir }: { conferir: () => Promise<unknown> }) {
  useHealthConnectRecheck(conferir);
  return null;
}

const montar = async (conferir: () => Promise<unknown>) => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(<Tela conferir={conferir} />);
  });
  return tree;
};

afterEach(() => {
  jest.restoreAllMocks();
});

describe('useHealthConnectRecheck', () => {
  // Antes da primeira rodada disponibilidade e permissão são nulas no estado.
  it('confere ao entrar', async () => {
    ouvirAppState();
    const conferir = jest.fn(async () => 'available');
    await montar(conferir);
    expect(conferir).toHaveBeenCalledTimes(1);
  });

  it('confere de novo a cada volta ao primeiro plano, e só nela', async () => {
    const appState = ouvirAppState();
    const conferir = jest.fn(async () => 'available');
    await montar(conferir);
    await appState.mudar('background');
    await appState.mudar('inactive');
    expect(conferir).toHaveBeenCalledTimes(1);
    await appState.mudar('active');
    expect(conferir).toHaveBeenCalledTimes(2);
  });

  it('sair da tela remove o ouvinte', async () => {
    const appState = ouvirAppState();
    const tree = await montar(jest.fn(async () => 'available'));
    expect(appState.remover).not.toHaveBeenCalled();
    await act(async () => {
      tree.unmount();
    });
    expect(appState.remover).toHaveBeenCalledTimes(1);
  });
});
