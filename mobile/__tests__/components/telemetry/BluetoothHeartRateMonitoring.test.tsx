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
    expect(botoes(tree)).toContain('Parar');
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

    expect(store.current()).toEqual(POLAR);
    expect(ponte.ble.stopScan).toHaveBeenCalled();
    expect(lista(tree)).toBeNull();
    expect(tags(tree)).toContainEqual({
      status: 'info',
      label: 'Polar H10. Liga sozinha durante a jornada',
    });
    expect(botoes(tree)).toEqual(['Trocar pulseira']);
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

  it('Parar encerra a varredura', async () => {
    const { tree, ponte } = await montar();
    await tocar(tree, 'Procurar pulseira');
    await tocar(tree, 'Parar');
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

describe('Pulseira no Bluetooth: estado e último batimento', () => {
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
    expect(tags(tree)).toContainEqual({
      status: 'info',
      label: 'Polar H10. Liga sozinha durante a jornada',
    });
  });

  it('mostra a hora do último batimento recebido', async () => {
    const ponte = ponteFalsa();
    const recebido = NOW.getTime() - 5_000;
    ponte.status = { state: 'connected', deviceId: POLAR.deviceId, lastReadingAt: recebido };
    const { tree } = await montar({ ponte, escolha: POLAR });
    const d = new Date(recebido);
    const hora = [d.getHours(), d.getMinutes(), d.getSeconds()]
      .map((n) => String(n).padStart(2, '0'))
      .join(':');
    expect(texto(tree)).toContain(`Último batimento recebido às ${hora}`);
  });

  it('sem batimento recebido ainda, não inventa hora', async () => {
    const { tree } = await montar({ escolha: POLAR });
    expect(texto(tree)).not.toContain('Último batimento');
  });
});

describe('Pulseira no Bluetooth: falha ao ligar durante a jornada', () => {
  // A falha vem do ciclo de vida, que a guarda para a tela; aqui ela é
  // provocada pelo próprio hook, com a ponte falsa recusando o `start`.
  const janelaAberta = async () => true;
  function Ligar({ ble }: { ble: BleHeartRate }) {
    useBluetoothHeartRate(
      { userId: 'u1', journeyState: 'ongoing', journeyKnown: true, paired: true, deviceId: POLAR.deviceId },
      ble,
      true,
      janelaAberta,
    );
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
