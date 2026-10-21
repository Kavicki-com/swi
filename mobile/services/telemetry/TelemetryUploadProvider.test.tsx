import { Platform } from 'react-native';
import { act, create } from 'react-test-renderer';
import { isFeatureEnabled, type FeatureGate } from '../../lib/featureFlags';
import { useAuth } from '../auth/AuthProvider';
import { androidDeviceControl } from './android/androidDeviceControl';
import { syncHealthConnectTaskRegistration } from './healthConnect/healthConnectBackgroundTask';
import type {
  HealthConnectReader,
  HealthConnectState,
} from './healthConnect/healthConnectReader';
import {
  TelemetryUploadProvider,
  useTelemetryUploadState,
  type TelemetryUploadContextValue,
} from './TelemetryUploadProvider';
import { createTelemetryOutbox } from './telemetryOutbox';
import { sharedHealthConnectReader, sharedTelemetryOutbox } from './telemetryRuntime';
import { useTelemetryUpload, type TelemetryUploadHandle } from './useTelemetryUpload';

// O envio vive na raiz: liga com sessão aberta dentro do piloto do Apple Watch
// (iPhone) ou do Health Connect (Android), e a tela de pareamento avisa quando
// a credencial nasce.

jest.mock('../auth/AuthProvider', () => ({ useAuth: jest.fn() }));
jest.mock('../../lib/featureFlags', () => ({ isFeatureEnabled: jest.fn() }));
jest.mock('./useTelemetryUpload', () => ({ useTelemetryUpload: jest.fn() }));
jest.mock('./telemetryRuntime', () => ({
  sharedTelemetryOutbox: jest.fn(),
  sharedHealthConnectReader: jest.fn(),
}));
jest.mock('./healthConnect/healthConnectBackgroundTask', () => ({
  syncHealthConnectTaskRegistration: jest.fn(async () => undefined),
}));
const mockSyncTask = syncHealthConnectTaskRegistration as jest.MockedFunction<
  typeof syncHealthConnectTaskRegistration
>;

const mockAuth = useAuth as jest.MockedFunction<typeof useAuth>;
const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;
const mockUpload = useTelemetryUpload as jest.MockedFunction<typeof useTelemetryUpload>;
const mockSharedOutbox = sharedTelemetryOutbox as jest.MockedFunction<
  typeof sharedTelemetryOutbox
>;
const mockSharedReader = sharedHealthConnectReader as jest.MockedFunction<
  typeof sharedHealthConnectReader
>;

const filaCompartilhada = createTelemetryOutbox({
  read: async () => null,
  write: async () => undefined,
});

const estadoHC = (lastSyncAt: string | null): HealthConnectState => ({
  availability: 'available',
  permission: 'granted',
  bandPackage: 'com.huami.watch.hmwatchmanager',
  bandLabel: 'Zepp',
  noBand: false,
  lastSyncAt,
});

// O leitor do Health Connect é dublê: o que importa aqui é quando o provider o
// chama, não o que ele lê.
function leitorFalso() {
  const ordem: string[] = [];
  const reader = {
    run: jest.fn(async (opts?: { force?: boolean }) => {
      ordem.push(opts?.force ? 'leitura forçada' : 'leitura');
      return 0;
    }),
    state: jest.fn(async () => {
      ordem.push('estado');
      return estadoHC('2026-10-20T12:00:00.000Z');
    }),
    redetect: jest.fn(async () => undefined),
    requestPermissions: jest.fn(async () => 'granted' as const),
    checkAccess: jest.fn(async () => 'available' as const),
    openSettings: jest.fn(),
  };
  return { reader: reader as jest.Mocked<HealthConnectReader>, ordem };
}

let leitor: ReturnType<typeof leitorFalso>;
let drainNow: jest.Mock<Promise<void>, []>;

const envio = (parcial: Partial<TelemetryUploadHandle> = {}): TelemetryUploadHandle => ({
  paired: false,
  lastOutcome: null,
  drainNow,
  ...parcial,
});

const comGates = (...ligados: FeatureGate[]) =>
  mockGate.mockImplementation((gate) => ligados.includes(gate));

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

const comUsuario = (user: unknown, restoring = false) =>
  mockAuth.mockReturnValue({ user, restoring } as unknown as ReturnType<typeof useAuth>);

let visto: TelemetryUploadContextValue;
function Leitor() {
  visto = useTelemetryUploadState();
  return null;
}

const opcoes = () => mockUpload.mock.calls[mockUpload.mock.calls.length - 1]![2];

async function montar() {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <TelemetryUploadProvider>
        <Leitor />
      </TelemetryUploadProvider>,
    );
  });
  return tree;
}

const argumentos = () => mockUpload.mock.calls[mockUpload.mock.calls.length - 1]!;

beforeEach(() => {
  jest.clearAllMocks();
  leitor = leitorFalso();
  drainNow = jest.fn(async () => {
    leitor.ordem.push('drenagem');
  });
  mockUpload.mockReturnValue(envio());
  mockGate.mockReturnValue(true);
  mockSharedOutbox.mockReturnValue(filaCompartilhada);
  mockSharedReader.mockReturnValue(leitor.reader);
  comUsuario({ id: 'w1' });
});

afterEach(() => {
  naPlataforma(originalOS);
});

describe('TelemetryUploadProvider', () => {
  it('com sessão aberta e dentro do piloto, o envio fica ligado', async () => {
    await montar();
    expect(mockGate).toHaveBeenCalledWith('appleWatchPilot');
    expect(opcoes()).toEqual({ enabled: true, recheckKey: 0 });
  });

  it('sem sessão o envio fica desligado', async () => {
    comUsuario(null);
    await montar();
    expect(opcoes()).toMatchObject({ enabled: false });
  });

  // Fora dos dois gates (Apple Watch no iPhone, Health Connect no Android), e
  // no Expo Go, não há de onde ler: nada a enviar.
  it('fora do piloto o envio fica desligado, mesmo com sessão', async () => {
    mockGate.mockReturnValue(false);
    await montar();
    expect(opcoes()).toMatchObject({ enabled: false });
  });

  it('entrega às telas o estado do envio', async () => {
    mockUpload.mockReturnValue(envio({ paired: true, lastOutcome: { outcome: 'idle' } }));
    await montar();
    expect(visto.paired).toBe(true);
    expect(visto.lastOutcome).toEqual({ outcome: 'idle' });
  });

  it('avisar o pareamento faz o envio reler a credencial', async () => {
    await montar();
    await act(async () => {
      visto.refreshPairing();
    });
    expect(opcoes()).toEqual({ enabled: true, recheckKey: 1 });
  });

  it('fora do provider a tela lê não pareado, sem quebrar', async () => {
    await act(async () => {
      create(<Leitor />);
    });
    expect(visto.paired).toBe(false);
    expect(visto.healthConnect).toBeNull();
    expect(() => visto.refreshPairing()).not.toThrow();
    await expect(visto.syncNow()).resolves.toBeUndefined();
    await expect(visto.requestHealthConnectPermission()).resolves.toBe('unavailable');
    await expect(visto.checkHealthConnect()).resolves.toBe('unavailable');
    expect(() => visto.openHealthConnectSettings()).not.toThrow();
  });
});

describe('TelemetryUploadProvider, iPhone', () => {
  it('segue com o controle padrão do relógio, sem leitor do Health Connect', async () => {
    naPlataforma('ios');
    comGates('appleWatchPilot');
    await montar();
    const [control, deps, options] = argumentos();
    expect(control).toBeUndefined();
    expect(deps).toBeUndefined();
    expect(options).toEqual({ enabled: true, recheckKey: 0 });
    expect(mockSharedReader).not.toHaveBeenCalled();
    expect(visto.healthConnect).toBeNull();
  });

  it('syncNow não faz nada fora do Android', async () => {
    naPlataforma('ios');
    comGates('appleWatchPilot');
    await montar();
    await act(async () => {
      await visto.syncNow();
    });
    expect(drainNow).not.toHaveBeenCalled();
    expect(mockSharedReader).not.toHaveBeenCalled();
  });

  it('pedir a permissão e conferir o Health Connect não fazem nada fora do Android', async () => {
    naPlataforma('ios');
    comGates('appleWatchPilot');
    await montar();
    await act(async () => {
      await expect(visto.requestHealthConnectPermission()).resolves.toBe('unavailable');
      await expect(visto.checkHealthConnect()).resolves.toBe('unavailable');
    });
    visto.openHealthConnectSettings();
    expect(mockSharedReader).not.toHaveBeenCalled();
  });

  // A tarefa de segundo plano é do Health Connect: no iPhone nem o registro
  // é consultado, com sessão, pareamento ou logout.
  it('nunca mexe no registro da tarefa de segundo plano', async () => {
    naPlataforma('ios');
    comGates('appleWatchPilot', 'healthConnect');
    mockUpload.mockReturnValue(envio({ paired: true }));
    await montar();
    comUsuario(null);
    await act(async () => {
      visto.refreshPairing();
    });
    expect(mockSyncTask).not.toHaveBeenCalled();
  });
});

describe('TelemetryUploadProvider, Android sem o gate', () => {
  it('nunca mexe no registro da tarefa de segundo plano', async () => {
    naPlataforma('android');
    comGates();
    await montar();
    expect(mockSyncTask).not.toHaveBeenCalled();
  });
});

describe('TelemetryUploadProvider, Android com Health Connect', () => {
  beforeEach(() => {
    naPlataforma('android');
    comGates('healthConnect');
    mockUpload.mockReturnValue(envio({ paired: true }));
  });

  // Uma resposta pendurada de `reader.state()`, para soltar quando o teste quiser.
  function estadoAdiado() {
    let soltar!: (estado: HealthConnectState) => void;
    leitor.reader.state.mockImplementationOnce(
      () =>
        new Promise<HealthConnectState>((resolve) => {
          soltar = resolve;
        }),
    );
    return (estado: HealthConnectState) => soltar(estado);
  }

  // Novo desfecho de envio, como o hook entrega a cada rodada.
  async function novoDesfecho(parcial: Partial<TelemetryUploadHandle> = {}) {
    mockUpload.mockReturnValue(
      envio({ paired: true, lastOutcome: { outcome: 'idle' }, ...parcial }),
    );
    await act(async () => {
      visto.refreshPairing();
    });
  }

  it('o gate do Health Connect liga o envio com o controle do Android e o leitor', async () => {
    await montar();
    const [control, deps, options] = argumentos();
    expect(options).toEqual({ enabled: true, recheckKey: 0 });
    expect(control).toBe(androidDeviceControl);
    expect(deps).toEqual({ outbox: filaCompartilhada, healthReader: leitor.reader });
  });

  it('sem sessão o envio fica desligado', async () => {
    comUsuario(null);
    await montar();
    expect(argumentos()[2]).toMatchObject({ enabled: false });
  });

  // `control` está nas dependências do efeito do envio: um objeto novo por
  // render religaria a fiação a cada render.
  it('controle e dependências são os mesmos entre renders', async () => {
    await montar();
    const [control, deps] = argumentos();
    await act(async () => {
      visto.refreshPairing();
    });
    expect(mockUpload.mock.calls.length).toBeGreaterThan(1);
    expect(argumentos()[0]).toBe(control);
    expect(argumentos()[1]).toBe(deps);
  });

  it('ao ligar, entrega às telas o estado do Health Connect', async () => {
    await montar();
    expect(leitor.reader.state).toHaveBeenCalled();
    expect(visto.healthConnect).toEqual(estadoHC('2026-10-20T12:00:00.000Z'));
  });

  // Cada rodada de envio passou pelo leitor: o estado pode ter mudado.
  it('relê o estado quando o desfecho do envio muda', async () => {
    await montar();
    const leiturasAntes = leitor.reader.state.mock.calls.length;
    leitor.reader.state.mockResolvedValueOnce(estadoHC('2026-10-20T12:15:00.000Z'));
    mockUpload.mockReturnValue(envio({ paired: true, lastOutcome: { outcome: 'idle' } }));
    await act(async () => {
      visto.refreshPairing();
    });
    expect(leitor.reader.state.mock.calls.length).toBe(leiturasAntes + 1);
    expect(visto.healthConnect?.lastSyncAt).toBe('2026-10-20T12:15:00.000Z');
  });

  it('syncNow força a leitura, drena na hora e relê o estado, nessa ordem', async () => {
    await montar();
    leitor.ordem.length = 0;
    leitor.reader.state.mockImplementationOnce(async () => {
      leitor.ordem.push('estado');
      return estadoHC('2026-10-20T12:30:00.000Z');
    });
    await act(async () => {
      await visto.syncNow();
    });
    expect(leitor.reader.run).toHaveBeenCalledWith({ force: true });
    expect(leitor.ordem).toEqual(['leitura forçada', 'drenagem', 'estado']);
    expect(visto.healthConnect?.lastSyncAt).toBe('2026-10-20T12:30:00.000Z');
  });

  // É um botão: uma falha não pode virar erro na tela.
  it('syncNow nunca rejeita, nem com leitor ou drenagem quebrados', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await montar();
    leitor.reader.run.mockRejectedValueOnce(new Error('ponte nativa caiu'));
    await act(async () => {
      await expect(visto.syncNow()).resolves.toBeUndefined();
    });
    drainNow.mockRejectedValueOnce(new Error('disco cheio'));
    await act(async () => {
      await expect(visto.syncNow()).resolves.toBeUndefined();
    });
    warn.mockRestore();
  });

  // Sem sessão não há de quem ler a saúde: nem o leitor é chamado.
  it('syncNow sem sessão não lê nem drena', async () => {
    comUsuario(null);
    await montar();
    await act(async () => {
      await visto.syncNow();
    });
    expect(leitor.reader.run).not.toHaveBeenCalled();
    expect(drainNow).not.toHaveBeenCalled();
  });

  // Sem pareamento a leitura forçada avançaria o token e nada subiria: a tela
  // mostraria uma sincronização nova que o painel nunca viu.
  it('syncNow com sessão e sem pareamento não lê nem drena', async () => {
    mockUpload.mockReturnValue(envio({ paired: false }));
    await montar();
    await act(async () => {
      await visto.syncNow();
    });
    expect(leitor.reader.run).not.toHaveBeenCalled();
    expect(drainNow).not.toHaveBeenCalled();
  });

  it('dois toques rápidos em syncNow são uma sincronização só', async () => {
    await montar();
    let soltar!: () => void;
    leitor.reader.run.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          soltar = () => resolve(0);
        }),
    );

    let primeiro!: Promise<void>;
    let segundo!: Promise<void>;
    await act(async () => {
      primeiro = visto.syncNow();
      segundo = visto.syncNow();
    });
    expect(segundo).toBe(primeiro);
    expect(leitor.reader.run).toHaveBeenCalledTimes(1);

    await act(async () => {
      soltar();
      await primeiro;
    });
    expect(drainNow).toHaveBeenCalledTimes(1);

    // Terminada, o próximo toque é uma sincronização nova.
    await act(async () => {
      await visto.syncNow();
    });
    expect(leitor.reader.run).toHaveBeenCalledTimes(2);
  });

  // A tela de pareamento pede a permissão pelo contexto, sem importar o
  // leitor: o provider repassa ao leitor único e relê o estado, para a tela
  // ver a resposta nova na hora.
  it('requestHealthConnectPermission pede ao leitor, relê o estado e devolve a resposta', async () => {
    await montar();
    leitor.ordem.length = 0;
    leitor.reader.requestPermissions.mockImplementationOnce(async () => {
      leitor.ordem.push('pedido');
      return 'denied';
    });
    leitor.reader.state.mockImplementationOnce(async () => {
      leitor.ordem.push('estado');
      return { ...estadoHC('2026-10-20T12:00:00.000Z'), permission: 'denied' };
    });
    let resposta: string | undefined;
    await act(async () => {
      resposta = await visto.requestHealthConnectPermission();
    });
    expect(resposta).toBe('denied');
    expect(leitor.ordem).toEqual(['pedido', 'estado']);
    expect(visto.healthConnect?.permission).toBe('denied');
  });

  // O leitor rejeita o pedido quando o Health Connect não está pronto (foi
  // desinstalado, pede atualização). A tela recebe 'unavailable', nunca erro,
  // e a disponibilidade é conferida de novo para ela oferecer a Play Store.
  it('requestHealthConnectPermission que rejeita vira unavailable e confere o acesso', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await montar();
    leitor.reader.requestPermissions.mockRejectedValueOnce(new Error('Health Connect ausente'));
    leitor.reader.checkAccess.mockResolvedValueOnce('unavailable');
    leitor.reader.state.mockResolvedValueOnce({
      ...estadoHC(null),
      availability: 'unavailable',
      permission: null,
    });
    let resposta: string | undefined;
    await act(async () => {
      resposta = await visto.requestHealthConnectPermission();
    });
    expect(resposta).toBe('unavailable');
    expect(leitor.reader.checkAccess).toHaveBeenCalledTimes(1);
    expect(visto.healthConnect?.availability).toBe('unavailable');
    warn.mockRestore();
  });

  // A volta dos ajustes ou da Play Store: o leitor confere disponibilidade e
  // permissão, e a tela vê as duas no estado relido.
  it('checkHealthConnect confere o acesso no leitor, relê o estado e devolve', async () => {
    await montar();
    leitor.reader.checkAccess.mockResolvedValueOnce('update_required');
    leitor.reader.state.mockResolvedValueOnce({
      ...estadoHC(null),
      availability: 'update_required',
      permission: null,
    });
    let resposta: string | undefined;
    await act(async () => {
      resposta = await visto.checkHealthConnect();
    });
    expect(resposta).toBe('update_required');
    expect(visto.healthConnect?.availability).toBe('update_required');
  });

  it('openHealthConnectSettings abre os ajustes pelo leitor', async () => {
    await montar();
    visto.openHealthConnectSettings();
    expect(leitor.reader.openSettings).toHaveBeenCalledTimes(1);
  });

  // Sem sessão o estado fica zerado (logout): nada a pedir nem a conferir.
  it('sem sessão, pedir a permissão e conferir não chamam o leitor', async () => {
    comUsuario(null);
    await montar();
    await act(async () => {
      await expect(visto.requestHealthConnectPermission()).resolves.toBe('unavailable');
      await expect(visto.checkHealthConnect()).resolves.toBe('unavailable');
    });
    expect(leitor.reader.requestPermissions).not.toHaveBeenCalled();
    expect(leitor.reader.checkAccess).not.toHaveBeenCalled();
    expect(visto.healthConnect).toBeNull();
  });

  // O envio roda a cada 15 s e cada desfecho relê o estado: sem mudança, as
  // telas não podem receber um objeto novo a cada rodada.
  it('estado relido igual mantém a mesma referência', async () => {
    await montar();
    const antes = visto.healthConnect;
    expect(antes).not.toBeNull();
    await novoDesfecho();
    expect(leitor.reader.state).toHaveBeenCalledTimes(2);
    expect(visto.healthConnect).toBe(antes);
  });

  it('o logout zera o estado do Health Connect', async () => {
    await montar();
    expect(visto.healthConnect).not.toBeNull();
    comUsuario(null);
    await act(async () => {
      visto.refreshPairing();
    });
    expect(visto.healthConnect).toBeNull();
  });

  // A sincronização começou com a sessão aberta e termina depois do logout:
  // a releitura do fim dela não pode repor o estado que o logout zerou.
  it('um syncNow em voo durante o logout não repõe o estado', async () => {
    await montar();
    let soltar!: () => void;
    leitor.reader.run.mockImplementationOnce(
      () =>
        new Promise<number>((resolve) => {
          soltar = () => resolve(0);
        }),
    );
    let sincronizacao!: Promise<void>;
    await act(async () => {
      sincronizacao = visto.syncNow();
    });

    comUsuario(null);
    await act(async () => {
      visto.refreshPairing();
    });
    expect(visto.healthConnect).toBeNull();

    await act(async () => {
      soltar();
      await sincronizacao;
    });
    expect(visto.healthConnect).toBeNull();
  });

  // A leitura da montagem demora, a do desfecho seguinte volta antes: a mais
  // velha, quando chegar, não pode apagar a mais nova.
  it('uma leitura do estado que volta fora de ordem não sobrescreve a mais nova', async () => {
    const soltarVelha = estadoAdiado();
    await montar();
    leitor.reader.state.mockResolvedValueOnce(estadoHC('2026-10-20T12:15:00.000Z'));
    await novoDesfecho();
    expect(visto.healthConnect?.lastSyncAt).toBe('2026-10-20T12:15:00.000Z');

    await act(async () => {
      soltarVelha(estadoHC('2026-10-20T12:00:00.000Z'));
    });
    expect(visto.healthConnect?.lastSyncAt).toBe('2026-10-20T12:15:00.000Z');
  });
});

// O registro da tarefa de segundo plano acompanha a sessão, o pareamento e o
// estado do Health Connect (a tela pode ter concedido a permissão de ler em
// segundo plano). Quem decide registrar ou não é a própria função; o provider
// só a chama quando um dos insumos muda.
describe('TelemetryUploadProvider, registro da tarefa de segundo plano', () => {
  beforeEach(() => {
    naPlataforma('android');
    comGates('healthConnect');
    mockUpload.mockReturnValue(envio({ paired: true }));
  });

  const ultimaSync = () => mockSyncTask.mock.calls[mockSyncTask.mock.calls.length - 1]![0];

  it('com sessão aberta, sincroniza o registro com a sessão ligada', async () => {
    await montar();
    expect(mockSyncTask).toHaveBeenCalled();
    expect(ultimaSync()).toEqual({ enabled: true });
  });

  it('o logout sincroniza com a sessão desligada', async () => {
    await montar();
    comUsuario(null);
    await act(async () => {
      visto.refreshPairing();
    });
    expect(ultimaSync()).toEqual({ enabled: false });
  });

  // Enquanto a sessão é restaurada não se sabe se há alguém logado: um
  // desregistro aqui tiraria a tarefa do agendador a cada abertura do app.
  it('não sincroniza enquanto a sessão é restaurada, e sincroniza ao terminar', async () => {
    comUsuario(null, true);
    await montar();
    expect(mockSyncTask).not.toHaveBeenCalled();
    comUsuario({ id: 'w1' });
    await act(async () => {
      visto.refreshPairing();
    });
    expect(ultimaSync()).toEqual({ enabled: true });
  });

  it('sincroniza de novo quando o pareamento muda', async () => {
    await montar();
    const antes = mockSyncTask.mock.calls.length;
    mockUpload.mockReturnValue(envio({ paired: false }));
    await act(async () => {
      visto.refreshPairing();
    });
    expect(mockSyncTask.mock.calls.length).toBe(antes + 1);
  });

  it('sincroniza de novo quando o estado do Health Connect muda', async () => {
    await montar();
    const antes = mockSyncTask.mock.calls.length;
    leitor.reader.state.mockResolvedValueOnce({
      ...estadoHC('2026-10-20T12:00:00.000Z'),
      permission: 'denied',
    });
    mockUpload.mockReturnValue(envio({ paired: true, lastOutcome: { outcome: 'idle' } }));
    await act(async () => {
      visto.refreshPairing();
    });
    expect(mockSyncTask.mock.calls.length).toBe(antes + 1);
  });

  // O envio roda a cada 15 s: um desfecho novo com o mesmo estado não pode
  // virar uma consulta nativa de permissões a cada rodada.
  it('não repete quando nada mudou', async () => {
    await montar();
    const antes = mockSyncTask.mock.calls.length;
    mockUpload.mockReturnValue(envio({ paired: true, lastOutcome: { outcome: 'idle' } }));
    await act(async () => {
      visto.refreshPairing();
    });
    expect(leitor.reader.state.mock.calls.length).toBeGreaterThan(1);
    expect(mockSyncTask.mock.calls.length).toBe(antes);
  });
});
