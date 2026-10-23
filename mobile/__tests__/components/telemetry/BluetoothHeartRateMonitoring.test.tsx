import { AppState } from 'react-native';
import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { Button, RadioGroup, StatusTag, SwiThemeProvider } from '@kavicki/swi-design-system';
import { BluetoothHeartRateMonitoring } from '../../../components/telemetry/BluetoothHeartRateMonitoring';
import type {
  BleHeartRate,
  BleHeartRateStatus,
  BleScanResult,
  BleStateChangedEvent,
} from '../../../modules/swi-ble-heart-rate/src';
import {
  createBandChoiceStore,
  useBandChoice,
  type BandChoice,
  type BandChoiceStore,
} from '../../../services/telemetry/bluetooth/bluetoothBandChoice';
import type {
  BluetoothPermissionAnswer,
  BluetoothPermissions,
} from '../../../services/telemetry/bluetooth/bluetoothPermissions';
import {
  resetBluetoothStartProblem,
  useBluetoothHeartRate,
} from '../../../services/telemetry/bluetooth/useBluetoothHeartRate';

// A seção Android do Monitoramento para a pulseira no Bluetooth: procurar,
// escolher, trocar, o estado da ligação, o último batimento e as permissões.
// As fronteiras dubladas são a ponte do módulo nativo (cumpre o contrato da
// ponte), o arquivo da escolha e o pedido de permissão.

const NOW = new Date('2026-10-22T15:00:00.000Z');
const POLAR: BandChoice = { deviceId: 'A0:9E:1A:00:00:01', name: 'Polar H10' };

interface PonteFalsa {
  ble: jest.Mocked<BleHeartRate>;
  status: BleHeartRateStatus;
  achar: (result: BleScanResult) => Promise<void>;
  mudar: (event: BleStateChangedEvent) => Promise<void>;
}

function ponteFalsa(): PonteFalsa {
  const scanListeners = new Set<(r: BleScanResult) => void>();
  const stateListeners = new Set<(e: BleStateChangedEvent) => void>();
  const p: PonteFalsa = {
    status: { state: 'idle', deviceId: null, lastReadingAt: null },
    ble: {
      supported: true,
      scan: jest.fn(async () => undefined),
      stopScan: jest.fn(),
      start: jest.fn(async (_deviceId: string) => undefined),
      stop: jest.fn(async () => undefined),
      rotateReadings: jest.fn(() => []),
      connectedIntervals: jest.fn((_sinceMs: number) => []),
      status: jest.fn(() => p.status),
      onScanResult: jest.fn((listener) => {
        scanListeners.add(listener);
        return () => scanListeners.delete(listener);
      }),
      onStateChanged: jest.fn((listener) => {
        stateListeners.add(listener);
        return () => stateListeners.delete(listener);
      }),
    } as unknown as jest.Mocked<BleHeartRate>,
    achar: async (result) => {
      await act(async () => scanListeners.forEach((l) => l(result)));
    },
    mudar: async (event) => {
      p.status = { ...p.status, state: event.state, deviceId: event.deviceId };
      await act(async () => stateListeners.forEach((l) => l(event)));
    },
  };
  return p;
}

function memoria(inicial: BandChoice | null = null) {
  const disco: { text: string | null; read: jest.Mock; write: jest.Mock } = {
    text: inicial ? JSON.stringify(inicial) : null,
    read: jest.fn(async (): Promise<string | null> => disco.text),
    write: jest.fn(async (text: string) => {
      disco.text = text;
    }),
  };
  return disco;
}

function permissoes(resposta: BluetoothPermissionAnswer = 'granted') {
  return {
    request: jest.fn(async () => resposta),
    openSettings: jest.fn(),
  } satisfies BluetoothPermissions;
}

let montada: ReactTestRenderer | null = null;

interface Cena {
  ponte: PonteFalsa;
  store: BandChoiceStore;
  perm: ReturnType<typeof permissoes>;
}

const arvore = ({ ponte, store, perm }: Cena) => (
  <SwiThemeProvider>
    <BluetoothHeartRateMonitoring ble={ponte.ble} store={store} permissions={perm} />
  </SwiThemeProvider>
);

async function montar(
  over: { escolha?: BandChoice | null; resposta?: BluetoothPermissionAnswer; ponte?: PonteFalsa } = {},
) {
  const cena: Cena = {
    ponte: over.ponte ?? ponteFalsa(),
    store: createBandChoiceStore(memoria(over.escolha ?? null)),
    perm: permissoes(over.resposta),
  };
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(arvore(cena));
  });
  montada = tree;
  return { tree, ...cena };
}

const texto = (tree: ReactTestRenderer): string => {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (node == null) return;
    if (typeof node === 'string' || typeof node === 'number') {
      out.push(String(node));
      return;
    }
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    walk((node as { children?: unknown }).children);
  };
  walk(tree.toJSON());
  return out.join(' ');
};

type BotaoProps = { label: string; onPress: () => void; disabled?: boolean };
const botoes = (tree: ReactTestRenderer) =>
  tree.root.findAllByType(Button as React.ComponentType<BotaoProps>).map((b) => b.props.label);
const tocar = async (tree: ReactTestRenderer, label: string) => {
  const alvo = tree.root
    .findAllByType(Button as React.ComponentType<BotaoProps>)
    .find((b) => b.props.label === label);
  if (!alvo) throw new Error(`sem o botão "${label}"`);
  await act(async () => {
    alvo.props.onPress();
  });
};

type TagProps = { label?: string; status?: string };
const tags = (tree: ReactTestRenderer) =>
  tree.root
    .findAllByType(StatusTag as React.ComponentType<TagProps>)
    .map((t) => ({ label: t.props.label, status: t.props.status }));

type GrupoProps = { options: { label: string; value: string }[]; onChange: (v: string) => void };
const lista = (tree: ReactTestRenderer) => {
  const grupos = tree.root.findAllByType(RadioGroup as React.ComponentType<GrupoProps>);
  return grupos.length === 0 ? null : grupos[0].props;
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  resetBluetoothStartProblem();
});

afterEach(async () => {
  await act(async () => {
    montada?.unmount();
  });
  montada = null;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('Pulseira no Bluetooth: escolha', () => {
  it('sem módulo (iOS, Expo Go) a seção não aparece', async () => {
    const ponte = ponteFalsa();
    ponte.ble.supported = false;
    const { tree } = await montar({ ponte });
    expect(tree.toJSON()).toBeNull();
  });

  it('sem pulseira escolhida diz isso e oferece procurar', async () => {
    const { tree } = await montar();
    expect(texto(tree)).toContain('Nenhuma pulseira escolhida');
    expect(botoes(tree)).toEqual(['Procurar pulseira']);
  });

  it('procurar pede a permissão e só então varre', async () => {
    const { tree, ponte, perm } = await montar();
    await tocar(tree, 'Procurar pulseira');
    expect(perm.request).toHaveBeenCalled();
    expect(ponte.ble.scan).toHaveBeenCalled();
    expect(tags(tree)).toContainEqual({ status: 'info', label: 'Procurando pulseiras por perto' });
    expect(botoes(tree)).toContain('Parar de procurar');
  });

  it('lista o que acha por nome e sinal, do mais forte ao mais fraco, sem repetir', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: 'B0:00:00:00:00:02', name: null, rssi: -90 });
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -75 });
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -50 });
    await ponte.achar({ deviceId: 'C0:00:00:00:00:03', name: 'Cinta', rssi: -70 });

    expect(lista(tree)?.options).toEqual([
      { value: POLAR.deviceId, label: 'Polar H10 · sinal forte' },
      { value: 'C0:00:00:00:00:03', label: 'Cinta · sinal médio' },
      { value: 'B0:00:00:00:00:02', label: 'Pulseira sem nome (00:02) · sinal fraco' },
    ]);
  });

  it('escolher guarda a pulseira, para a varredura e mostra a escolhida', async () => {
    const { tree, ponte, store } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -60 });

    await act(async () => lista(tree)?.onChange(POLAR.deviceId));

    expect(store.current()).toMatchObject(POLAR);
    expect(ponte.ble.stopScan).toHaveBeenCalled();
    expect(lista(tree)).toBeNull();
    expect(tags(tree)).toContainEqual({ status: 'info', label: 'Polar H10 escolhida' });
    expect(botoes(tree)).toEqual(['Trocar pulseira', 'Encerrar']);
  });

  it('anúncio que chega enquanto a escolha é gravada não traz a lista de volta', async () => {
    const { tree, ponte, store } = await montar();
    let gravar!: () => void;
    const original = store.choose.bind(store);
    jest.spyOn(store, 'choose').mockImplementationOnce(async (band) => {
      await new Promise<void>((resolve) => {
        gravar = resolve;
      });
      await original(band);
    });
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -60 });

    await act(async () => lista(tree)?.onChange(POLAR.deviceId));
    // A varredura do Android repete o anúncio várias vezes por segundo: um
    // deles cai depois de a escolha ir ao disco e antes de a tela trocar de
    // fase (o ouvinte só sai no commit).
    const ouvinte = ponte.ble.onScanResult.mock.calls.at(-1)![0];
    await act(async () => {
      gravar();
      for (let i = 0; i < 20; i += 1) await Promise.resolve();
      ouvinte({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -58 });
    });

    expect(store.current()).toMatchObject(POLAR);
    expect(lista(tree)).toBeNull();
    expect(botoes(tree)).toEqual(['Trocar pulseira', 'Encerrar']);
  });

  it('falha ao guardar avisa e mantém a lista', async () => {
    const { tree, ponte, store } = await montar();
    jest.spyOn(store, 'choose').mockRejectedValueOnce(new Error('cheio'));
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -60 });

    await act(async () => lista(tree)?.onChange(POLAR.deviceId));

    expect(texto(tree)).toContain('Não foi possível guardar a pulseira. Tente de novo.');
    expect(lista(tree)).not.toBeNull();
  });

  it('para sozinha em 30 s; sem nada achado, diz o que conferir', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(ponte.ble.stopScan).toHaveBeenCalled();
    expect(texto(tree)).toContain(
      'Nenhuma pulseira encontrada. Confira se ela está ligada e perto do celular.',
    );
    expect(botoes(tree)).toEqual(['Procurar pulseira']);
  });

  it('em 30 s com pulseiras achadas, a lista fica para escolher', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -60 });
    await act(async () => {
      jest.advanceTimersByTime(30_000);
    });
    expect(lista(tree)?.options).toHaveLength(1);
    expect(botoes(tree)).toEqual(['Procurar pulseira']);
  });

  it('Parar de procurar encerra a varredura', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await tocar(tree, 'Parar de procurar');
    expect(ponte.ble.stopScan).toHaveBeenCalled();
  });

  it('sair da tela no meio da varredura a encerra', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await act(async () => tree.unmount());
    montada = null;
    expect(ponte.ble.stopScan).toHaveBeenCalled();
  });

  it('trocar refaz a varredura com a pulseira atual ainda guardada', async () => {
    const { tree, ponte, store } = await montar({ escolha: POLAR });
    await tocar(tree, 'Trocar pulseira');
    expect(ponte.ble.scan).toHaveBeenCalled();
    expect(store.current()).toEqual(POLAR);
  });
});

describe('Pulseira no Bluetooth: permissões e falhas da varredura', () => {
  it('permissão negada: não varre, explica e deixa tentar de novo', async () => {
    const { tree, ponte } = await montar({ resposta: 'denied' });
    await tocar(tree, 'Procurar pulseira');
    expect(ponte.ble.scan).not.toHaveBeenCalled();
    expect(texto(tree)).toContain(
      'Sem a permissão de Bluetooth não é possível procurar a pulseira.',
    );
    expect(botoes(tree)).toEqual(['Procurar pulseira']);
  });

  it('"não perguntar de novo": o caminho é pelos ajustes', async () => {
    const { tree, perm } = await montar({ resposta: 'blocked' });
    await tocar(tree, 'Procurar pulseira');
    expect(texto(tree)).toContain('Libere o Bluetooth nos ajustes do app.');
    await tocar(tree, 'Abrir ajustes');
    expect(perm.openSettings).toHaveBeenCalled();
  });

  it.each([
    ['E_BLUETOOTH_OFF', 'Ligue o Bluetooth do celular e procure de novo.'],
    ['E_BLUETOOTH_UNAVAILABLE', 'Este celular não tem Bluetooth de baixa energia.'],
    ['E_PERMISSION_DENIED', 'Sem a permissão de Bluetooth não é possível procurar a pulseira.'],
    ['E_OUTRO', 'Não foi possível procurar a pulseira. Tente de novo.'],
  ])('varredura recusada com %s explica', async (code, frase) => {
    const ponte = ponteFalsa();
    ponte.ble.scan.mockRejectedValueOnce(Object.assign(new Error(code), { code }));
    const { tree } = await montar({ ponte });
    await tocar(tree, 'Procurar pulseira');
    expect(texto(tree)).toContain(frase);
    expect(botoes(tree)).toContain('Procurar pulseira');
  });
});

describe('Pulseira no Bluetooth: estado da ligação', () => {
  it.each([
    ['connected', 'accept', 'Polar H10 conectada'],
    ['searching', 'pending', 'Procurando Polar H10'],
    ['bluetoothOff', 'canceled', 'Bluetooth do celular desligado'],
  ] as const)('ligação %s', async (state, status, label) => {
    const ponte = ponteFalsa();
    ponte.status = { state, deviceId: POLAR.deviceId, lastReadingAt: null };
    const { tree } = await montar({ ponte, escolha: POLAR });
    expect(tags(tree)).toContainEqual({ status, label });
  });

  it('acompanha a mudança de estado vinda do serviço', async () => {
    const ponte = ponteFalsa();
    const { tree } = await montar({ ponte, escolha: POLAR });
    await ponte.mudar({ state: 'connected', deviceId: POLAR.deviceId, changedAt: NOW.getTime() });
    expect(tags(tree)).toContainEqual({ status: 'accept', label: 'Polar H10 conectada' });
  });

  it('o serviço ainda com a pulseira anterior não conta como a escolhida', async () => {
    const ponte = ponteFalsa();
    ponte.status = { state: 'connected', deviceId: 'Z0:00', lastReadingAt: null };
    const { tree } = await montar({ ponte, escolha: POLAR });
    expect(tags(tree)).toContainEqual({ status: 'info', label: 'Polar H10 escolhida' });
  });
});

describe('Pulseira no Bluetooth: falha ao ligar', () => {
  // A falha vem do ciclo de vida, que a guarda para a tela; aqui ela é
  // provocada pelo próprio hook, com a ponte falsa recusando o `start`.
  function Ligar({ ble }: { ble: BleHeartRate }) {
    useBluetoothHeartRate({ userId: 'u1', paired: true, deviceId: POLAR.deviceId }, ble, true);
    return null;
  }

  async function comFalha(code: string) {
    // O hook só pede o serviço com o app em primeiro plano.
    Object.defineProperty(AppState, 'currentState', { get: () => 'active', configurable: true });
    const ponte = ponteFalsa();
    ponte.ble.start.mockRejectedValue(Object.assign(new Error(code), { code }));
    await act(async () => {
      create(<Ligar ble={ponte.ble} />);
    });
    return montar({ ponte, escolha: POLAR });
  }

  it('permissão negada: explica e leva aos ajustes', async () => {
    const { tree, perm } = await comFalha('E_PERMISSION_DENIED');
    expect(texto(tree)).toContain(
      'A pulseira não liga sem a permissão de Bluetooth. Libere nos ajustes do app.',
    );
    await tocar(tree, 'Abrir ajustes');
    expect(perm.openSettings).toHaveBeenCalled();
  });

  it('outra falha: explica sem levar aos ajustes', async () => {
    const { tree } = await comFalha('E_START_FAILED');
    expect(texto(tree)).toContain(
      'Não foi possível ligar a pulseira. Ela tenta de novo quando o app abrir.',
    );
    expect(botoes(tree)).not.toContain('Abrir ajustes');
  });
});

describe('Pulseira no Bluetooth: ativar e encerrar o monitoramento', () => {
  // A tela e o ciclo de vida juntos, com a mesma escolha: escolher é ativar,
  // e Encerrar é o único jeito de a pessoa desligar. Nenhuma jornada aqui.
  function Ciclo({ ble, store }: { ble: BleHeartRate; store: BandChoiceStore }) {
    const choice = useBandChoice(store);
    useBluetoothHeartRate(
      { userId: 'u1', paired: true, deviceId: choice === undefined ? undefined : (choice?.deviceId ?? null) },
      ble,
      true,
    );
    return null;
  }

  async function montarComCiclo(escolha: BandChoice | null = null) {
    Object.defineProperty(AppState, 'currentState', { get: () => 'active', configurable: true });
    const ponte = ponteFalsa();
    const disco = memoria(escolha);
    const cena: Cena = { ponte, store: createBandChoiceStore(disco), perm: permissoes() };
    let tree!: ReactTestRenderer;
    await act(async () => {
      tree = create(
        <SwiThemeProvider>
          <Ciclo ble={ponte.ble} store={cena.store} />
          <BluetoothHeartRateMonitoring ble={ponte.ble} store={cena.store} permissions={cena.perm} />
        </SwiThemeProvider>,
      );
    });
    montada = tree;
    return { tree, disco, ...cena };
  }

  it('o texto da seção não fala em jornada e diz como encerrar', async () => {
    const { tree } = await montar();
    expect(texto(tree)).not.toMatch(/jornada/i);
    expect(texto(tree)).toContain('até você tocar em Encerrar');
  });

  it('escolher a pulseira liga a escuta na hora, sem jornada', async () => {
    const { tree, ponte } = await montarComCiclo();
    expect(ponte.ble.start).not.toHaveBeenCalled();
    await tocar(tree, 'Procurar pulseira');
    await ponte.achar({ deviceId: POLAR.deviceId, name: 'Polar H10', rssi: -60 });
    await act(async () => lista(tree)?.onChange(POLAR.deviceId));
    expect(ponte.ble.start).toHaveBeenCalledWith(POLAR.deviceId);
  });

  it('Encerrar desliga a escuta, apaga a escolha e volta a oferecer procurar', async () => {
    const { tree, ponte, disco, store } = await montarComCiclo(POLAR);
    expect(ponte.ble.start).toHaveBeenCalledWith(POLAR.deviceId);
    await tocar(tree, 'Encerrar');
    expect(ponte.ble.stop).toHaveBeenCalled();
    expect(store.current()).toBeNull();
    expect(disco.text).toBe('');
    expect(texto(tree)).toContain('Nenhuma pulseira escolhida');
    expect(botoes(tree)).toEqual(['Procurar pulseira']);
  });

  it('Encerrar que não grava avisa e mantém a pulseira', async () => {
    const { tree, disco, store } = await montarComCiclo(POLAR);
    disco.write.mockRejectedValueOnce(new Error('cheio'));
    await tocar(tree, 'Encerrar');
    expect(store.current()).toMatchObject(POLAR);
    expect(texto(tree)).toContain('Não foi possível encerrar. Tente de novo.');
    expect(botoes(tree)).toContain('Encerrar');
  });

  it('sem pulseira escolhida, e durante a procura, não há Encerrar', async () => {
    const { tree } = await montar();
    expect(botoes(tree)).not.toContain('Encerrar');
    const comEscolha = await montar({ escolha: POLAR });
    await tocar(comEscolha.tree, 'Trocar pulseira');
    expect(botoes(comEscolha.tree)).toEqual(['Parar de procurar']);
  });

  it('trocar de pulseira liga a escuta com a nova', async () => {
    const { tree, ponte } = await montarComCiclo(POLAR);
    await tocar(tree, 'Trocar pulseira');
    await ponte.achar({ deviceId: 'B0:00:00:00:00:02', name: 'Mi Band', rssi: -50 });
    await act(async () => lista(tree)?.onChange('B0:00:00:00:00:02'));
    expect(ponte.ble.start).toHaveBeenLastCalledWith('B0:00:00:00:00:02');
  });
});
