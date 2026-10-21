import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { Platform } from 'react-native';
import { isFeatureEnabled } from '../../lib/featureFlags';
import type { WatchControl } from '../../modules/swi-watch-control';
import { useAuth } from '../auth/AuthProvider';
import { androidDeviceControl } from './android/androidDeviceControl';
import { syncHealthConnectTaskRegistration } from './healthConnect/healthConnectBackgroundTask';
import type {
  HealthConnectPermission,
  HealthConnectReader,
  HealthConnectState,
} from './healthConnect/healthConnectReader';
import type { HealthConnectAvailability } from './healthConnect/healthConnectSource';
import { sharedHealthConnectReader, sharedTelemetryOutbox } from './telemetryRuntime';
import {
  useTelemetryUpload,
  type TelemetryUploadDeps,
  type TelemetryUploadState,
} from './useTelemetryUpload';

// O envio da telemetria ao backend, montado na raiz do app para não depender
// de tela aberta. Liga com sessão aberta dentro do piloto do Apple Watch (só
// iOS compilado) ou do Health Connect (só Android compilado); a credencial do
// aparelho é relida no login e quando a tela de pareamento avisa que concluiu.
// Com o 401 o envio para e o estado volta a não pareado, até um novo
// pareamento.
//
// No Android o envio usa o controle do Android (credencial no SecureStore) e
// o leitor do Health Connect no passo do `healthReader`, os dois sobre a fila
// única do runtime (telemetryRuntime.ts). No iPhone segue como sempre: o
// controle padrão do relógio e o leitor do app Saúde que o hook cria.
//
// Também no Android, o provider mantém o registro da tarefa de segundo plano
// do Health Connect (healthConnectBackgroundTask.ts) em dia com a sessão, o
// pareamento e o estado do Health Connect. A tarefa em si é definida no
// carregamento do bundle (index.js); aqui só se decide se ela fica no
// agendador do sistema.
//
// A tela de pareamento do Android pede a permissão de leitura, confere o
// acesso e abre os ajustes do Health Connect por este contexto, e o
// Monitoramento em Configurações também redetecta a pulseira por ele, para
// nunca importar o leitor nem a porta: o leitor é um só por runtime.

export interface TelemetryUploadContextValue extends TelemetryUploadState {
  /** A tela de pareamento chama ao concluir: o envio relê a credencial. */
  refreshPairing: () => void;
  /** O que o leitor do Health Connect sabe; nulo fora do Android com o gate. */
  healthConnect: HealthConnectState | null;
  /**
   * "Sincronizar agora": lê o Health Connect sem esperar o intervalo, drena o
   * envio na hora e relê o estado. Nunca rejeita; sem efeito fora do Android
   * com o gate, sem sessão ou sem pareamento. Tocado de novo antes de
   * terminar, devolve a mesma sincronização em vez de começar outra.
   */
  syncNow: () => Promise<void>;
  /**
   * Verdadeiro enquanto a sincronização única de `syncNow` corre; falso ao
   * terminar, com sucesso ou não. As faixas de sincronização das telas leem o
   * progresso daqui, e não de uma flag própria: com Minhas estatísticas
   * empilhada sobre o Dashboard as duas mostram o mesmo estado. O `syncNow`
   * inerte (sem sessão, sem pareamento) não o liga.
   */
  syncing: boolean;
  /**
   * Abre o pedido de permissão de leitura do Health Connect (tela de
   * pareamento) e relê o estado. Nunca rejeita: o leitor rejeita quando o
   * Health Connect não está pronto, e isso volta como `'unavailable'`, com o
   * acesso já conferido de novo. `'unavailable'` também fora do Android com
   * o gate e sem sessão, sem chamar nada.
   */
  requestHealthConnectPermission: () => Promise<HealthConnectPermission | 'unavailable'>;
  /**
   * Confere o acesso ao Health Connect (se há o app e se a leitura está
   * concedida; antes da primeira rodada as duas são nulas no estado) e relê
   * o estado. É a volta dos ajustes ou da Play Store na tela de pareamento.
   * Devolve a disponibilidade. Nunca rejeita; `'unavailable'` fora do
   * Android com o gate e sem sessão.
   */
  checkHealthConnect: () => Promise<HealthConnectAvailability>;
  /** Abre os ajustes do Health Connect; sem efeito fora do Android com o gate. */
  openHealthConnectSettings: () => void;
  /**
   * "Redetectar pulseira" (Configurações, Monitoramento): o leitor esquece a
   * pulseira detectada e o estado é relido, já sem ela. Devolve se deu certo;
   * quem chama pede `syncNow` em seguida, para a detecção acontecer na hora em
   * vez de na próxima rodada. Nunca rejeita: o leitor rejeita quando o estado
   * não pôde ser gravado, e isso volta como `false`, com aviso, para a tela
   * dizer que não deu. `false` também fora do Android com o gate e sem sessão,
   * sem chamar nada.
   */
  redetectBand: () => Promise<boolean>;
}

const FORA_DO_PROVIDER: TelemetryUploadContextValue = {
  paired: false,
  lastOutcome: null,
  refreshPairing: () => undefined,
  healthConnect: null,
  syncNow: async () => undefined,
  syncing: false,
  requestHealthConnectPermission: async () => 'unavailable',
  checkHealthConnect: async () => 'unavailable',
  openHealthConnectSettings: () => undefined,
  redetectBand: async () => false,
};

const TelemetryUploadContext = createContext<TelemetryUploadContextValue>(FORA_DO_PROVIDER);

interface Wiring {
  /** Indefinidos no iPhone: o hook usa os padrões dele. */
  control: WatchControl | undefined;
  deps: TelemetryUploadDeps | undefined;
  reader: HealthConnectReader | null;
}

const IPHONE: Wiring = { control: undefined, deps: undefined, reader: null };

// Todo campo do estado, para a comparação abaixo. O Record cobre a chave
// inteira de propósito: um campo novo não compila até entrar aqui.
const HEALTH_CONNECT_FIELDS: Record<keyof HealthConnectState, true> = {
  availability: true,
  permission: true,
  bandPackage: true,
  bandLabel: true,
  noBand: true,
  lastSyncAt: true,
};

// Os campos são todos primitivos: igualdade campo a campo basta.
const sameHealthConnect = (a: HealthConnectState, b: HealthConnectState) =>
  (Object.keys(HEALTH_CONNECT_FIELDS) as (keyof HealthConnectState)[]).every(
    (field) => a[field] === b[field],
  );

const warn = (what: string, error: unknown) =>
  console.warn(
    `[TelemetryUploadProvider] ${what}: ${String(
      (error as { message?: unknown })?.message ?? error,
    )}`,
  );

export function TelemetryUploadProvider({ children }: PropsWithChildren) {
  const { user, restoring } = useAuth();
  const [recheckKey, setRecheckKey] = useState(0);
  const [healthConnect, setHealthConnect] = useState<HealthConnectState | null>(null);
  // O gate já embute a plataforma, e a conferência repetida aqui é o que
  // garante que o leitor (e o arquivo de estado dele) nunca nasce no iPhone.
  const onHealthConnect = Platform.OS === 'android' && isFeatureEnabled('healthConnect');
  const enabled =
    user != null && (isFeatureEnabled('appleWatchPilot') || isFeatureEnabled('healthConnect'));
  // Os mesmos objetos em todo render: `control` está nas dependências do
  // efeito do envio, e um objeto novo religaria a fiação a cada render. A
  // plataforma e o gate não mudam durante o processo.
  const wiring = useMemo<Wiring>(() => {
    if (!onHealthConnect) return IPHONE;
    const reader = sharedHealthConnectReader();
    return {
      control: androidDeviceControl,
      deps: { outbox: sharedTelemetryOutbox(), healthReader: reader },
      reader,
    };
  }, [onHealthConnect]);
  const { reader } = wiring;

  const state = useTelemetryUpload(wiring.control, wiring.deps, { enabled, recheckKey });
  const { drainNow, lastOutcome, paired } = state;
  const refreshPairing = useCallback(() => setRecheckKey((k) => k + 1), []);

  // Cada leitura do estado tira uma senha, e só a da senha mais recente
  // escreve. Leituras do efeito e do `syncNow` podem voltar fora de ordem, e
  // a mais velha apagaria a mais nova; o logout também tira uma senha, para
  // uma leitura em voo não repor o estado que ele acabou de zerar.
  const lastTicket = useRef(0);
  // A senha não basta para um `syncNow` que atravessa o logout: a releitura
  // do fim dele tira uma senha DEPOIS do logout e venceria. A sessão lida na
  // hora de gravar fecha esse caminho.
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  // O pareamento lido do mesmo jeito, no momento da chamada: um `syncNow`
  // guardado de um render anterior (a tela que redetecta e só sincroniza
  // depois de um `await`) veria o `paired` da captura, e um 401 no meio do
  // caminho não o pararia.
  const pairedRef = useRef(paired);
  pairedRef.current = paired;
  const refreshHealthConnect = useCallback(async (from: HealthConnectReader) => {
    lastTicket.current += 1;
    const ticket = lastTicket.current;
    const next = await from.state();
    if (ticket !== lastTicket.current || !enabledRef.current) return;
    // Igual ao que já está: mantém o objeto, e as telas não renderizam à toa
    // a cada rodada de envio.
    setHealthConnect((prev) => (prev !== null && sameHealthConnect(prev, next) ? prev : next));
  }, []);

  // Relido ao ligar e a cada desfecho de envio: toda rodada passou pelo
  // leitor, e a pulseira, a permissão ou a última leitura podem ter mudado.
  // `state()` só lê o arquivo e nunca rejeita. Sem sessão (logout), zera: o
  // que a pessoa anterior via não fica para a próxima.
  useEffect(() => {
    if (reader === null || !enabled) {
      lastTicket.current += 1;
      setHealthConnect(null);
      return;
    }
    refreshHealthConnect(reader).catch((error: unknown) =>
      warn('estado do Health Connect ilegível', error),
    );
  }, [reader, enabled, lastOutcome, refreshHealthConnect]);

  // O registro da tarefa de segundo plano, conferido de novo quando um dos
  // insumos muda: a sessão (logout tira a tarefa do agendador), o pareamento
  // (um 401 derruba o `paired`) e o estado do Health Connect. O estado é o
  // gatilho da permissão de segundo plano, que a tela pode ter acabado de
  // conceder; ele só troca de objeto quando algum campo muda (ver
  // `sameHealthConnect`), então um desfecho de envio igual, a cada 15 s, não
  // vira uma consulta nativa de permissões. O `lastSyncAt` muda a cada rodada
  // completa do leitor, o que reconfere também uma permissão concedida nos
  // ajustes do sistema, no máximo uns 15 min depois.
  // Enquanto a sessão é restaurada não há decisão a tomar: o `user` ainda é
  // nulo, e desregistrar ali tiraria a tarefa do agendador a cada abertura
  // do app. `syncHealthConnectTaskRegistration` nunca rejeita.
  // Abrir o app sem servidor e sem cópia de sessão recente termina a
  // restauração com `user` nulo e desregistra; o registro volta quando a
  // sessão se confirmar (aceito pela especificação).
  useEffect(() => {
    if (!onHealthConnect || restoring) return;
    void syncHealthConnectTaskRegistration({ enabled });
  }, [onHealthConnect, restoring, enabled, paired, healthConnect]);

  // A sincronização em curso: um segundo toque recebe a mesma promessa. O
  // estado `syncing` espelha a ref para as telas; a ref é o que decide, porque
  // o estado só muda no próximo render e dois toques no mesmo quadro o
  // veriam ainda falso.
  const inFlight = useRef<Promise<void> | null>(null);
  const [syncing, setSyncing] = useState(false);
  const syncNow = useCallback((): Promise<void> => {
    if (inFlight.current !== null) return inFlight.current;
    // Sem sessão não há de quem ler a saúde. Sem pareamento a leitura
    // forçada avançaria o token do Health Connect e nada subiria: a tela
    // mostraria uma sincronização nova que o painel nunca recebeu. Os dois
    // pelas refs, os de agora: quem chama pode ter guardado esta função de
    // um render em que ainda havia sessão e pareamento.
    if (reader === null || !enabledRef.current || !pairedRef.current) return Promise.resolve();
    const run = (async () => {
      try {
        // `run` nunca rejeita e `drainNow` também não; o `try` é para um
        // botão nunca receber erro, mesmo se um dos dois mudar.
        await reader.run({ force: true });
        await drainNow();
        await refreshHealthConnect(reader);
      } catch (error) {
        warn('sincronização pedida falhou', error);
      }
    })().finally(() => {
      // Encadeado, e não dentro do bloco acima: um `finally` encadeado roda
      // sempre depois desta função voltar, então nunca limpa antes de a
      // promessa ser guardada, e a promessa devolvida só resolve já limpa.
      inFlight.current = null;
      setSyncing(false);
    });
    inFlight.current = run;
    setSyncing(true);
    return run;
  }, [reader, drainNow, refreshHealthConnect]);

  // A releitura depois de pedir ou conferir: ilegível só avisa, a tela segue
  // com o estado que já tinha.
  const rereadHealthConnect = useCallback(
    (from: HealthConnectReader) =>
      refreshHealthConnect(from).catch((error: unknown) =>
        warn('estado do Health Connect ilegível', error),
      ),
    [refreshHealthConnect],
  );

  // A tela de pareamento fala com o leitor único por aqui, em vez de
  // importar o leitor ou a porta. Sem sessão não há pedido: o estado está
  // zerado e a releitura nem gravaria.
  const requestHealthConnectPermission = useCallback(async (): Promise<
    HealthConnectPermission | 'unavailable'
  > => {
    if (reader === null || !enabled) return 'unavailable';
    let answer: HealthConnectPermission | 'unavailable';
    try {
      answer = await reader.requestPermissions();
    } catch (error) {
      // O leitor rejeita com o Health Connect ausente ou pedindo
      // atualização. Conferir o acesso põe a disponibilidade certa no
      // estado, e a tela troca o pedido pelo caminho da Play Store.
      warn('pedido de permissão do Health Connect falhou', error);
      await reader.checkAccess();
      answer = 'unavailable';
    }
    await rereadHealthConnect(reader);
    return answer;
  }, [reader, enabled, rereadHealthConnect]);

  const checkHealthConnect = useCallback(async (): Promise<HealthConnectAvailability> => {
    if (reader === null || !enabled) return 'unavailable';
    const availability = await reader.checkAccess();
    await rereadHealthConnect(reader);
    return availability;
  }, [reader, enabled, rereadHealthConnect]);

  // Abrir os ajustes não lê dado de ninguém: basta haver leitor.
  const openHealthConnectSettings = useCallback(() => {
    reader?.openSettings();
  }, [reader]);

  // Sem sessão o estado está zerado, como nos pedidos acima: não há pulseira
  // de quem esquecer. Não exige pareamento: esquecer a pulseira não envia
  // nada, e a tela só oferece o botão a quem está pareado. Com falha não há
  // releitura: nada foi gravado, e o estado que a tela tem continua certo.
  const redetectBand = useCallback(async (): Promise<boolean> => {
    if (reader === null || !enabled) return false;
    try {
      await reader.redetect();
    } catch (error) {
      warn('redetecção da pulseira falhou', error);
      return false;
    }
    await rereadHealthConnect(reader);
    return true;
  }, [reader, enabled, rereadHealthConnect]);

  const value = useMemo(
    () => ({
      paired,
      lastOutcome,
      refreshPairing,
      healthConnect,
      syncNow,
      syncing,
      requestHealthConnectPermission,
      checkHealthConnect,
      openHealthConnectSettings,
      redetectBand,
    }),
    [
      paired,
      lastOutcome,
      refreshPairing,
      healthConnect,
      syncNow,
      syncing,
      requestHealthConnectPermission,
      checkHealthConnect,
      openHealthConnectSettings,
      redetectBand,
    ],
  );
  return <TelemetryUploadContext.Provider value={value}>{children}</TelemetryUploadContext.Provider>;
}

export function useTelemetryUploadState(): TelemetryUploadContextValue {
  return useContext(TelemetryUploadContext);
}
