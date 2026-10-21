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
import type {
  HealthConnectReader,
  HealthConnectState,
} from './healthConnect/healthConnectReader';
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
}

const FORA_DO_PROVIDER: TelemetryUploadContextValue = {
  paired: false,
  lastOutcome: null,
  refreshPairing: () => undefined,
  healthConnect: null,
  syncNow: async () => undefined,
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
  const { user } = useAuth();
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

  // A sincronização em curso: um segundo toque recebe a mesma promessa.
  const syncing = useRef<Promise<void> | null>(null);
  const syncNow = useCallback((): Promise<void> => {
    if (syncing.current !== null) return syncing.current;
    // Sem sessão não há de quem ler a saúde. Sem pareamento a leitura
    // forçada avançaria o token do Health Connect e nada subiria: a tela
    // mostraria uma sincronização nova que o painel nunca recebeu.
    if (reader === null || !enabled || !paired) return Promise.resolve();
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
      syncing.current = null;
    });
    syncing.current = run;
    return run;
  }, [reader, enabled, paired, drainNow, refreshHealthConnect]);

  const value = useMemo(
    () => ({ paired, lastOutcome, refreshPairing, healthConnect, syncNow }),
    [paired, lastOutcome, refreshPairing, healthConnect, syncNow],
  );
  return <TelemetryUploadContext.Provider value={value}>{children}</TelemetryUploadContext.Provider>;
}

export function useTelemetryUploadState(): TelemetryUploadContextValue {
  return useContext(TelemetryUploadContext);
}
