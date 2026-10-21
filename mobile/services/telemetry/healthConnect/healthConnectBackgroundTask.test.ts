import { Platform } from 'react-native';
import * as BackgroundTask from 'expo-background-task';
import * as TaskManager from 'expo-task-manager';
import { isFeatureEnabled } from '../../../lib/featureFlags';
import type { WatchControl } from '../../../modules/swi-watch-control';
import { androidDeviceControl } from '../android/androidDeviceControl';
import { sharedHealthConnectReader, sharedTelemetryOutbox } from '../telemetryRuntime';
import {
  createTelemetryUploader,
  MAX_DRAIN_ROUNDS,
  type TelemetryUploader,
  type UploadOutcome,
} from '../telemetryUploader';
import {
  defineHealthConnectTask,
  HEALTH_CONNECT_TASK_NAME,
  runHealthConnectBackgroundRound,
  syncHealthConnectTaskRegistration,
} from './healthConnectBackgroundTask';
import { BACKGROUND_ACCESS_PERMISSION, type HealthConnectSource } from './healthConnectSource';

// A tarefa de segundo plano do Health Connect: a rodada (ler e drenar), a
// definição no carregamento do bundle e o registro no agendador do sistema.
// Os módulos nativos são dublês; o que importa aqui é quando cada um é
// chamado, não o que o sistema faz com isso.

jest.mock('expo-task-manager', () => ({ defineTask: jest.fn() }));
jest.mock('expo-background-task', () => ({
  registerTaskAsync: jest.fn(async () => undefined),
  unregisterTaskAsync: jest.fn(async () => undefined),
  BackgroundTaskResult: { Success: 1, Failed: 2 },
}));
jest.mock('../../../lib/featureFlags', () => ({ isFeatureEnabled: jest.fn() }));
jest.mock('../telemetryRuntime', () => ({
  sharedTelemetryOutbox: jest.fn(),
  sharedHealthConnectReader: jest.fn(),
}));
jest.mock('../android/androidDeviceControl', () => ({
  androidDeviceControl: { hasDeviceCredential: jest.fn(() => false) },
}));
jest.mock('../telemetryUploader', () => ({
  ...jest.requireActual('../telemetryUploader'),
  createTelemetryUploader: jest.fn(),
}));

const SUCCESS = BackgroundTask.BackgroundTaskResult.Success;
const FAILED = BackgroundTask.BackgroundTaskResult.Failed;

const mockGate = isFeatureEnabled as jest.MockedFunction<typeof isFeatureEnabled>;
const mockSharedOutbox = sharedTelemetryOutbox as jest.MockedFunction<
  typeof sharedTelemetryOutbox
>;
const mockSharedReader = sharedHealthConnectReader as jest.MockedFunction<
  typeof sharedHealthConnectReader
>;
const mockCreateUploader = createTelemetryUploader as jest.MockedFunction<
  typeof createTelemetryUploader
>;
const mockRegister = BackgroundTask.registerTaskAsync as jest.MockedFunction<
  typeof BackgroundTask.registerTaskAsync
>;
const mockUnregister = BackgroundTask.unregisterTaskAsync as jest.MockedFunction<
  typeof BackgroundTask.unregisterTaskAsync
>;
const mockDefaultCredential = androidDeviceControl.hasDeviceCredential as jest.Mock;

const enviado = (accepted: number, remaining: number): UploadOutcome => ({
  outcome: 'sent',
  accepted,
  duplicates: 0,
  conflicts: 0,
  remaining,
});

const controle = (comCredencial: boolean) =>
  ({ hasDeviceCredential: jest.fn(() => comCredencial) }) as unknown as WatchControl & {
    hasDeviceCredential: jest.Mock;
  };

// Leitor e envio dublês que anotam a ordem das chamadas.
function dubles(desfechos: UploadOutcome[] = [{ outcome: 'idle' }]) {
  const ordem: string[] = [];
  const reader = {
    run: jest.fn(async (_opts?: { force?: boolean }) => {
      ordem.push('leitura');
      return 0;
    }),
  };
  let i = 0;
  const uploader: TelemetryUploader & { uploadPending: jest.Mock } = {
    uploadPending: jest.fn(async () => {
      ordem.push('envio');
      const desfecho = desfechos[Math.min(i, desfechos.length - 1)];
      i += 1;
      return desfecho;
    }),
  };
  return { reader, uploader, ordem };
}

const fonte = (concedidas: string[] | Error) =>
  ({
    grantedPermissions: jest.fn(async () => {
      if (concedidas instanceof Error) throw concedidas;
      return concedidas;
    }),
  }) as unknown as HealthConnectSource & { grantedPermissions: jest.Mock };

const originalOS = Platform.OS;
const naPlataforma = (os: typeof Platform.OS) =>
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });

beforeEach(() => {
  jest.clearAllMocks();
  mockGate.mockReturnValue(true);
  mockDefaultCredential.mockReturnValue(false);
});

afterEach(() => {
  naPlataforma(originalOS);
});

describe('runHealthConnectBackgroundRound', () => {
  // Sem credencial não há como autenticar o envio: nem o leitor roda (ele
  // avançaria o token do Health Connect e nada subiria).
  it('sem credencial do aparelho não lê nem envia', async () => {
    const { reader, uploader } = dubles();
    await expect(
      runHealthConnectBackgroundRound({ control: controle(false), reader, uploader }),
    ).resolves.toBe(SUCCESS);
    expect(reader.run).not.toHaveBeenCalled();
    expect(uploader.uploadPending).not.toHaveBeenCalled();
  });

  // Pelos padrões: sem credencial, nem a fila nem o leitor do runtime nascem,
  // e o arquivo de estado do leitor não é tocado.
  it('sem credencial, pelos padrões, não cria fila, leitor nem envio', async () => {
    await expect(runHealthConnectBackgroundRound()).resolves.toBe(SUCCESS);
    expect(mockDefaultCredential).toHaveBeenCalled();
    expect(mockSharedReader).not.toHaveBeenCalled();
    expect(mockSharedOutbox).not.toHaveBeenCalled();
    expect(mockCreateUploader).not.toHaveBeenCalled();
  });

  // O intervalo de 15 min do leitor vale: a tarefa não força a leitura.
  it('com credencial, lê sem forçar e só depois drena', async () => {
    const { reader, uploader, ordem } = dubles();
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), reader, uploader }),
    ).resolves.toBe(SUCCESS);
    expect(reader.run).toHaveBeenCalledTimes(1);
    expect(reader.run).toHaveBeenCalledWith();
    expect(ordem).toEqual(['leitura', 'envio']);
  });

  it('pelos padrões, usa o leitor e a fila do runtime com o controle do Android', async () => {
    mockDefaultCredential.mockReturnValue(true);
    const fila = { compartilhada: true };
    mockSharedOutbox.mockReturnValue(fila as never);
    const { reader, uploader } = dubles();
    mockSharedReader.mockReturnValue(reader as never);
    mockCreateUploader.mockReturnValue(uploader);
    await expect(runHealthConnectBackgroundRound()).resolves.toBe(SUCCESS);
    expect(mockCreateUploader).toHaveBeenCalledWith({
      outbox: fila,
      control: androidDeviceControl,
    });
    expect(reader.run).toHaveBeenCalledTimes(1);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('drena enquanto sobra fila e há progresso, e para com a fila zerada', async () => {
    const { reader, uploader } = dubles([enviado(200, 300), enviado(200, 100), enviado(100, 0)]);
    await runHealthConnectBackgroundRound({ control: controle(true), reader, uploader });
    expect(uploader.uploadPending).toHaveBeenCalledTimes(3);
  });

  it('para no unpaired', async () => {
    const { reader, uploader } = dubles([{ outcome: 'unpaired' }, enviado(1, 0)]);
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), reader, uploader }),
    ).resolves.toBe(SUCCESS);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('para sem progresso, mesmo com fila sobrando', async () => {
    const { reader, uploader } = dubles([enviado(0, 50), enviado(50, 0)]);
    await runHealthConnectBackgroundRound({ control: controle(true), reader, uploader });
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('tem teto: para em MAX_DRAIN_ROUNDS com fila que nunca zera', async () => {
    const { reader, uploader } = dubles([enviado(200, 10_000)]);
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), reader, uploader }),
    ).resolves.toBe(SUCCESS);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(MAX_DRAIN_ROUNDS);
  });

  // Rede fora ou 5xx: a fila ficou intacta e a rodada não entregou nada.
  it('envio adiado vira Failed', async () => {
    const { reader, uploader } = dubles([{ outcome: 'deferred' }]);
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), reader, uploader }),
    ).resolves.toBe(FAILED);
  });

  it('nunca rejeita: credencial ilegível, leitor ou envio quebrados viram Failed', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const quebrado = controle(true);
    quebrado.hasDeviceCredential.mockImplementation(() => {
      throw new Error('keystore');
    });
    const a = dubles();
    await expect(
      runHealthConnectBackgroundRound({ control: quebrado, reader: a.reader, uploader: a.uploader }),
    ).resolves.toBe(FAILED);

    const b = dubles();
    b.reader.run.mockRejectedValueOnce(new Error('ponte nativa'));
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), ...b }),
    ).resolves.toBe(FAILED);

    const c = dubles();
    c.uploader.uploadPending.mockRejectedValueOnce(new Error('disco'));
    await expect(
      runHealthConnectBackgroundRound({ control: controle(true), ...c }),
    ).resolves.toBe(FAILED);
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });
});

describe('defineHealthConnectTask', () => {
  type Executor = (body: { data?: unknown; error?: unknown }) => Promise<unknown>;
  const executor = (): Executor => (TaskManager.defineTask as jest.Mock).mock.calls[0][1];

  it('no Android com o gate, define a tarefa pelo nome, e ela roda a rodada', async () => {
    naPlataforma('android');
    defineHealthConnectTask();
    expect(TaskManager.defineTask).toHaveBeenCalledWith(
      HEALTH_CONNECT_TASK_NAME,
      expect.any(Function),
    );
    mockDefaultCredential.mockReturnValue(true);
    mockSharedOutbox.mockReturnValue({} as never);
    const { reader, uploader } = dubles();
    mockSharedReader.mockReturnValue(reader as never);
    mockCreateUploader.mockReturnValue(uploader);
    await expect(executor()({})).resolves.toBe(SUCCESS);
    expect(reader.run).toHaveBeenCalledTimes(1);
    expect(uploader.uploadPending).toHaveBeenCalledTimes(1);
  });

  it('a tarefa nunca rejeita', async () => {
    naPlataforma('android');
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    defineHealthConnectTask();
    mockDefaultCredential.mockImplementation(() => {
      throw new Error('keystore');
    });
    await expect(executor()({ error: new Error('sistema') })).resolves.toBe(FAILED);
    warn.mockRestore();
  });

  it('no Android sem o gate não define nada', () => {
    naPlataforma('android');
    mockGate.mockReturnValue(false);
    defineHealthConnectTask();
    expect(mockGate).toHaveBeenCalledWith('healthConnect');
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });

  it('fora do Android não define nada, mesmo com o gate', () => {
    naPlataforma('ios');
    defineHealthConnectTask();
    expect(TaskManager.defineTask).not.toHaveBeenCalled();
  });
});

describe('syncHealthConnectTaskRegistration', () => {
  const comTudo = (permissoes: string[] | Error = ['HeartRate', BACKGROUND_ACCESS_PERMISSION]) => ({
    enabled: true,
    control: controle(true),
    source: fonte(permissoes),
  });

  it('sessão ligada, pareada e com permissão de segundo plano: registra a cada 15 min', async () => {
    await syncHealthConnectTaskRegistration(comTudo());
    expect(mockRegister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME, { minimumInterval: 15 });
    expect(mockUnregister).not.toHaveBeenCalled();
  });

  it('sem a permissão de segundo plano, desregistra', async () => {
    await syncHealthConnectTaskRegistration(comTudo(['HeartRate', 'Steps']));
    expect(mockUnregister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME);
    expect(mockRegister).not.toHaveBeenCalled();
  });

  // Logout: nem a permissão é consultada.
  it('sessão desligada desregistra', async () => {
    const opts = { ...comTudo(), enabled: false };
    await syncHealthConnectTaskRegistration(opts);
    expect(mockUnregister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(opts.source.grantedPermissions).not.toHaveBeenCalled();
  });

  it('sem credencial do aparelho (não pareado), desregistra', async () => {
    const opts = { ...comTudo(), control: controle(false) };
    await syncHealthConnectTaskRegistration(opts);
    expect(mockUnregister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME);
    expect(mockRegister).not.toHaveBeenCalled();
    expect(opts.source.grantedPermissions).not.toHaveBeenCalled();
  });

  it('pelos padrões, a credencial é a do controle do Android', async () => {
    await syncHealthConnectTaskRegistration({ enabled: true, source: fonte([]) });
    expect(mockDefaultCredential).toHaveBeenCalled();
    expect(mockUnregister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME);
  });

  // Uma consulta que falhou não diz nada sobre a permissão: o registro fica
  // como estava, em vez de derrubar um agendamento válido por um soluço.
  it('permissão ilegível: não rejeita e não mexe no registro', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await expect(
      syncHealthConnectTaskRegistration(comTudo(new Error('ponte nativa'))),
    ).resolves.toBeUndefined();
    expect(mockRegister).not.toHaveBeenCalled();
    expect(mockUnregister).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });

  it('falha do módulo nativo não rejeita', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    mockRegister.mockRejectedValueOnce(new Error('WorkManager'));
    await expect(syncHealthConnectTaskRegistration(comTudo())).resolves.toBeUndefined();
    mockUnregister.mockRejectedValueOnce(new Error('WorkManager'));
    await expect(
      syncHealthConnectTaskRegistration({ ...comTudo(), enabled: false }),
    ).resolves.toBeUndefined();
    const quebrado = controle(true);
    quebrado.hasDeviceCredential.mockImplementation(() => {
      throw new Error('keystore');
    });
    await expect(
      syncHealthConnectTaskRegistration({ ...comTudo(), control: quebrado }),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(3);
    warn.mockRestore();
  });

  // Uma aplicação que rejeita fora dos `try` (aqui, um insumo que lança ao
  // ser lido) não pode envenenar a fila: o logout seguinte ainda desregistra,
  // e quem chamou não recebe rejeição.
  it('uma aplicação que rejeita não impede a seguinte', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const quebrada = { enabled: true } as { enabled: boolean; control?: never };
    Object.defineProperty(quebrada, 'control', {
      get() {
        throw new Error('insumo ilegível');
      },
    });
    await expect(syncHealthConnectTaskRegistration(quebrada)).resolves.toBeUndefined();
    await syncHealthConnectTaskRegistration({ ...comTudo(), enabled: false });
    expect(mockUnregister).toHaveBeenCalledWith(HEALTH_CONNECT_TASK_NAME);
    warn.mockRestore();
  });

  // O registro que entrou primeiro consulta a permissão devagar; o logout
  // chega no meio. Sem ordem, o desregistro do logout terminaria antes e o
  // registro atrasado deixaria a tarefa ligada depois do logout.
  it('chamadas seguidas acontecem em ordem: a última decide', async () => {
    const acoes: string[] = [];
    mockRegister.mockImplementation(async () => {
      acoes.push('registra');
    });
    mockUnregister.mockImplementation(async () => {
      acoes.push('desregistra');
    });
    let soltar!: () => void;
    const lenta = fonte([]);
    lenta.grantedPermissions.mockImplementationOnce(
      () =>
        new Promise<string[]>((resolve) => {
          soltar = () => resolve([BACKGROUND_ACCESS_PERMISSION]);
        }),
    );
    const primeira = syncHealthConnectTaskRegistration({
      enabled: true,
      control: controle(true),
      source: lenta,
    });
    const logout = syncHealthConnectTaskRegistration({ ...comTudo(), enabled: false });
    await Promise.resolve();
    await Promise.resolve();
    soltar();
    await Promise.all([primeira, logout]);
    expect(acoes).toEqual(['registra', 'desregistra']);
  });
});
