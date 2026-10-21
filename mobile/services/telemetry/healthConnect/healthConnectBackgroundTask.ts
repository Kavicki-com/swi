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
  shouldDrainAgain,
  type TelemetryUploader,
  type UploadOutcome,
} from '../telemetryUploader';
import type { HealthConnectReader } from './healthConnectReader';
import {
  BACKGROUND_ACCESS_PERMISSION,
  healthConnectSource,
  type HealthConnectSource,
} from './healthConnectSource';

// Leitura do Health Connect com o app fora da tela. Com o app aberto, quem lê
// e envia é o laço do primeiro plano (useTelemetryUpload, montado pelo
// TelemetryUploadProvider); esta tarefa cobre o resto do turno, quando a
// pessoa guardou o celular no bolso e a pulseira continua gravando no Health
// Connect pelo app dela.
//
// O que a tarefa depende e o que ela NÃO garante:
//
// - só existe no Android com o gate `healthConnect`, e só é registrada com a
//   permissão `BackgroundAccessPermission` concedida. Essa permissão de ler
//   em segundo plano é do Android 15 em diante (antes disso, só onde o Health
//   Connect a oferece como recurso), e sem ela o Health Connect recusa a
//   leitura com o app fora da tela;
// - quem agenda é o sistema, pelo WorkManager (`expo-background-task`), com
//   mínimo de 15 min entre execuções. É um mínimo, não um horário: economia
//   de bateria, modo soneca e o próprio fabricante podem espaçar bem mais.
//   No Android o `expo-background-task` 1.0.10 reagenda a execução seguinte
//   sozinho, qualquer que seja o resultado devolvido aqui;
// - a validação real, com o app fechado, é no emulador. Os testes daqui
//   cobrem a lógica da rodada e do registro, não o agendador.
//
// Dois riscos achados na revisão e confirmados no emulador:
//
// - TIMERS NÃO DISPARAM AQUI. Com o app em segundo plano, ou subido sem tela
//   pelo WorkManager, os timers do JavaScript não disparam no RN 0.81: o
//   `JavaTimerManager` fica pausado quando não há HeadlessJsTask, e o
//   expo-task-manager não usa o `HeadlessJsTaskContext`. Por isso o envio
//   não usa `fetch` (ele só entrega a resposta dentro de um setTimeout, e a
//   rodada pendurava logo depois do lote chegar ao backend): o controle do
//   Android vai pelo XMLHttpRequest, com o prazo cumprido pelo OkHttp
//   (xhrTransport.ts). O que continua sem proteção é o `withTimeout` da
//   porta do Health Connect: uma chamada nativa travada deixa a rodada
//   pendurada até o WorkManager encerrar o worker (uns 10 min). Nenhum dado
//   se perde: a fila é durável e o token só avança depois de enfileirar;
// - A BIBLIOTECA REINICIA O AGENDAMENTO. No `expo-background-task` 1.0.10 com
//   o expo-task-manager, todo início a frio do processo (inclusive o que o
//   próprio WorkManager provoca para rodar a tarefa) passa por
//   `restoreTasks`, que chama `scheduleWorker(cancelExisting = true)` com
//   `REPLACE`: a contagem de 15 min recomeça, e provavelmente o worker em
//   execução é cancelado. Vem da biblioteca, não deste arquivo; os cuidados
//   daqui para "não reiniciar o agendamento" valem só para as chamadas que
//   o app faz (registrar e desregistrar).
//
// FILA E LEITOR COMPARTILHADOS: a rodada usa a fila e o leitor ÚNICOS do
// runtime (telemetryRuntime.ts), os mesmos do primeiro plano. Duas filas
// sobre o mesmo arquivo apagariam eventos uma da outra, e o leitor avança o
// token do Health Connect depois de enfileirar: um evento apagado assim não
// volta mais. O envio daqui é um uploader próprio sobre a mesma fila; se ele
// coincidir com uma drenagem do primeiro plano, o pior caso é o mesmo lote
// subir duas vezes, e o backend responde repetição.

/**
 * Nome da tarefa no TaskManager e no WorkManager. Estável: trocar o nome
 * deixa a anterior órfã, registrada no sistema e sem ninguém que a defina.
 */
export const HEALTH_CONNECT_TASK_NAME = 'swi-health-connect-sync';

/** Intervalo pedido ao agendador, em minutos; 15 é o mínimo que o Android aceita. */
export const HEALTH_CONNECT_TASK_INTERVAL_MINUTES = 15;

export interface HealthConnectBackgroundDeps {
  /** O padrão é o `androidDeviceControl`. */
  control?: WatchControl;
  /** O padrão é o leitor do runtime (`sharedHealthConnectReader`). */
  reader?: Pick<HealthConnectReader, 'run'>;
  /** O padrão é um uploader sobre a fila do runtime e o `control`. */
  uploader?: TelemetryUploader;
}

const warn = (what: string, error: unknown) =>
  console.warn(
    `[healthConnectBackgroundTask] ${what}: ${String(
      (error as { message?: unknown })?.message ?? error,
    )}`,
  );

/**
 * Uma execução da tarefa: lê o Health Connect e drena a fila. Nunca rejeita.
 *
 * Sem credencial do aparelho não toca nada: o envio não teria como se
 * autenticar, e uma leitura avançaria o token do Health Connect sem nada
 * subir. Os padrões (fila, leitor, uploader) só nascem depois dessa
 * conferência, para uma execução sem pareamento não abrir nem o arquivo de
 * estado do leitor.
 *
 * A leitura não é forçada: o intervalo de 15 min do leitor vale aqui também,
 * e uma execução que caia logo depois de uma rodada do primeiro plano só
 * drena. A drenagem para pelo mesmo critério do primeiro plano
 * (`shouldDrainAgain` e `MAX_DRAIN_ROUNDS`).
 *
 * `Failed` quando algo lançou (não deveria: leitor e uploader não rejeitam)
 * ou quando o envio terminou adiado (rede fora, 5xx), porque aí a rodada não
 * entregou nada. Sem credencial, fila vazia ou credencial recusada (401) são
 * `Success`: a tarefa fez tudo o que podia, e o registro é desfeito pelo
 * primeiro plano quando ele perceber o fim do pareamento. No Android, com o
 * `expo-background-task` 1.0.10, a biblioteca descarta esse valor (o worker
 * termina igual e é reagendado); ele fica pelo contrato da tarefa e pelo log.
 */
export async function runHealthConnectBackgroundRound(
  deps: HealthConnectBackgroundDeps = {},
): Promise<BackgroundTask.BackgroundTaskResult> {
  try {
    const control = deps.control ?? androidDeviceControl;
    if (!control.hasDeviceCredential()) return BackgroundTask.BackgroundTaskResult.Success;
    const reader = deps.reader ?? sharedHealthConnectReader();
    const uploader =
      deps.uploader ?? createTelemetryUploader({ outbox: sharedTelemetryOutbox(), control });

    await reader.run();
    let last: UploadOutcome | null = null;
    for (let round = 0; round < MAX_DRAIN_ROUNDS; round += 1) {
      last = await uploader.uploadPending();
      if (!shouldDrainAgain(last)) break;
    }
    return last?.outcome === 'deferred'
      ? BackgroundTask.BackgroundTaskResult.Failed
      : BackgroundTask.BackgroundTaskResult.Success;
  } catch (error) {
    warn('rodada falhou', error);
    return BackgroundTask.BackgroundTaskResult.Failed;
  }
}

/**
 * Define a tarefa. Precisa rodar no carregamento do bundle (index.js), antes
 * de qualquer tela: quando o WorkManager acorda o app só para a tarefa,
 * nenhuma rota é montada, e uma tarefa definida dentro de uma tela não
 * existiria nesse processo. O registro (`registerTaskAsync`) também exige a
 * tarefa já definida.
 *
 * Fora do Android ou sem o gate não define nada: o leitor nem existe ali.
 */
export function defineHealthConnectTask(): void {
  if (Platform.OS !== 'android' || !isFeatureEnabled('healthConnect')) return;
  // A rodada nunca rejeita; o erro que o sistema passe no corpo não muda
  // nada, porque a tarefa não recebe dado nenhum dele.
  TaskManager.defineTask(HEALTH_CONNECT_TASK_NAME, () => runHealthConnectBackgroundRound());
}

export interface HealthConnectTaskRegistrationOptions {
  /** Sessão aberta dentro do gate; desligada (logout), a tarefa sai do agendador. */
  enabled: boolean;
  /** Quem diz se o aparelho está pareado; o padrão é o `androidDeviceControl`. */
  control?: Pick<WatchControl, 'hasDeviceCredential'>;
  /** Quem diz as permissões concedidas; o padrão é a porta do Health Connect. */
  source?: Pick<HealthConnectSource, 'grantedPermissions'>;
}

// As chamadas em fila, uma depois da outra. Cada uma consulta a permissão
// antes de agir, e sem ordem um registro que entrou antes e consultou devagar
// terminaria depois do desregistro do logout, deixando a tarefa ligada sem
// sessão. Em fila, a última chamada é a última a agir.
let pending: Promise<void> = Promise.resolve();

async function applyRegistration(opts: HealthConnectTaskRegistrationOptions): Promise<void> {
  const control = opts.control ?? androidDeviceControl;
  const source = opts.source ?? healthConnectSource;

  let wanted: boolean;
  try {
    // Pareado pela credencial, lida na hora, e não pelo `paired` do envio:
    // ao abrir a sessão, o `paired` do hook fica um render atrás da sessão, e
    // agir sobre ele desregistraria e registraria de novo a cada abertura do
    // app, reiniciando a contagem do WorkManager por uma chamada nossa (o
    // reinício que a biblioteca já faz em todo início a frio é outro, ver o
    // cabeçalho). A credencial é a mesma fonte que o hook lê, e a que a
    // própria rodada confere.
    wanted =
      opts.enabled &&
      control.hasDeviceCredential() &&
      (await source.grantedPermissions()).includes(BACKGROUND_ACCESS_PERMISSION);
  } catch (error) {
    // Uma consulta que falhou não diz nada sobre a permissão. O registro fica
    // como estava: derrubar um agendamento válido por um soluço da ponte
    // custaria um turno sem leitura, e um registro que sobrou é inofensivo,
    // porque a rodada confere a credencial e o leitor trata a recusa do
    // Health Connect sozinho.
    warn('permissões ilegíveis, registro mantido', error);
    return;
  }

  try {
    // As duas chamadas da biblioteca são idempotentes: registrar o que já
    // está registrado e desregistrar o que não está não fazem nada. Isso vale
    // para estas chamadas do app; o `restoreTasks` da biblioteca, no início a
    // frio, reagenda por conta própria (ver o cabeçalho).
    if (wanted) {
      await BackgroundTask.registerTaskAsync(HEALTH_CONNECT_TASK_NAME, {
        minimumInterval: HEALTH_CONNECT_TASK_INTERVAL_MINUTES,
      });
    } else {
      await BackgroundTask.unregisterTaskAsync(HEALTH_CONNECT_TASK_NAME);
    }
  } catch (error) {
    warn(wanted ? 'registro falhou' : 'desregistro falhou', error);
  }
}

/**
 * Põe a tarefa no agendador só com sessão aberta, aparelho pareado e a
 * permissão de ler em segundo plano concedida; em qualquer outro caso tira.
 * Nunca rejeita (a falha vai para o log). Chamada pelo
 * TelemetryUploadProvider, só no Android com o gate, quando a sessão, o
 * pareamento ou o estado do Health Connect mudam.
 */
export function syncHealthConnectTaskRegistration(
  opts: HealthConnectTaskRegistrationOptions,
): Promise<void> {
  // A falha é tratada na própria promessa guardada: uma aplicação que
  // rejeitasse (hoje tudo está dentro de `try`, mas um insumo pode lançar ao
  // ser lido) deixaria a fila rejeitada, e toda chamada seguinte, inclusive o
  // desregistro do logout, rejeitaria sem agir. Tratada aqui, quem chama
  // também nunca recebe rejeição.
  const run = pending
    .then(() => applyRegistration(opts))
    .catch((error: unknown) => warn('sincronização do registro falhou', error));
  pending = run;
  return run;
}
