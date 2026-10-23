import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, RadioGroup, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system';
import {
  bleHeartRate,
  bleHeartRateErrorCode,
  type BleHeartRate,
  type BleHeartRateStatus,
  type BleScanResult,
  type BleStateChangedEvent,
} from '../../modules/swi-ble-heart-rate/src';
import {
  sharedBandChoiceStore,
  useBandChoice,
  type BandChoiceStore,
} from '../../services/telemetry/bluetooth/bluetoothBandChoice';
import {
  BLUETOOTH_MONITORING_COPY as COPY,
  bandNameCopy,
  directBpmCopy,
  disconnectedSinceCopy,
  linkTagCopy,
  scanOptionCopy,
  scanProblemCopy,
  startProblemCopy,
  type ScanProblem,
} from '../../services/telemetry/bluetooth/bluetoothCopy';
import {
  bluetoothPermissions,
  type BluetoothPermissions,
} from '../../services/telemetry/bluetooth/bluetoothPermissions';
import {
  BLE_HEART_RATE_MAX_BPM,
  BLE_HEART_RATE_MIN_BPM,
} from '../../services/telemetry/bluetooth/bluetoothInboxDrain';
import { decodeBase64, parseHeartRateMeasurement } from '../../services/telemetry/bluetooth/heartRateMeasurement';
import { useBluetoothStartProblem } from '../../services/telemetry/bluetooth/useBluetoothHeartRate';

// A pulseira no Bluetooth em Configurações > Monitoramento, abaixo do Health
// Connect: escolher uma vez a pulseira que transmite pelo perfil padrão de
// batimento (0x180D), trocar, encerrar, ver o estado da ligação e o
// batimento direto da pulseira. Escolher é ativar o monitoramento e
// Encerrar o termina; quem liga e desliga o serviço com essa escolha é o
// ciclo de vida
// (useBluetoothHeartRate.ts). Mora fora de `app/` porque tudo ali vira rota
// no Expo Router; aqui só compõe o DS.
//
// A varredura pede as permissões antes (a folha do sistema), roda no máximo
// 30 s e para ao escolher, ao tocar Parar de procurar e ao sair da tela:
// varrer gasta bateria e, no Android, tem cota por app.
//
// O batimento aqui vem direto da ponte, não do servidor: é a única tela que
// lê a ponte para mostrar o valor, para a pessoa ver que a conexão está
// servindo. O dashboard segue lendo o batimento pelo servidor.

export const SCAN_TIMEOUT_MS = 30_000;

/** De quanto em quanto a tela relê o status da ponte com a pulseira escolhida. */
export const STATUS_POLL_MS = 2_000;

/** Até quanto tempo a última notificação ainda vale como o batimento de agora. */
export const DIRECT_READING_FRESH_MS = 10_000;

type ScanPhase = 'idle' | 'scanning' | 'done';

function scanProblemOf(error: unknown): ScanProblem {
  switch (bleHeartRateErrorCode(error)) {
    case 'E_PERMISSION_DENIED':
      return 'denied';
    case 'E_BLUETOOTH_OFF':
      return 'bluetoothOff';
    case 'E_BLUETOOTH_UNAVAILABLE':
      return 'unavailable';
    default:
      return 'failed';
  }
}

/** O batimento dos bytes da última notificação, ou null se não é leitura. */
function directBpmOf(base64: string | null | undefined): number | null {
  if (!base64) return null;
  const bytes = decodeBase64(base64);
  if (bytes === null) return null;
  const measurement = parseHeartRateMeasurement(bytes);
  // Os mesmos descartes da drenagem: sem pele ou fora da faixa não é batimento.
  if (measurement === null || measurement.contact === 'notDetected') return null;
  const { bpm } = measurement;
  return bpm < BLE_HEART_RATE_MIN_BPM || bpm > BLE_HEART_RATE_MAX_BPM ? null : bpm;
}

type DirectReading =
  | { kind: 'bpm'; bpm: number }
  | { kind: 'waiting' }
  | { kind: 'disconnected'; since: number };

function directReadingOf(
  status: BleHeartRateStatus,
  change: BleStateChangedEvent | null,
  now: number,
): DirectReading | null {
  if (status.state !== 'connected') {
    // A hora da mudança só vale se foi a mudança para o estado de agora. Com a
    // tela aberta já sem conexão, a última leitura é o mais perto que se sabe
    // de quando ela caiu; sem nenhuma das duas, não se inventa hora.
    const since = change?.state === status.state ? change.changedAt : status.lastReadingAt;
    return since === null ? null : { kind: 'disconnected', since };
  }
  const fresh = status.lastReadingAt !== null && now - status.lastReadingAt <= DIRECT_READING_FRESH_MS;
  const bpm = fresh ? directBpmOf(status.lastBytes) : null;
  return bpm === null ? { kind: 'waiting' } : { kind: 'bpm', bpm };
}

/** Uma entrada por pulseira, com o sinal mais recente, da mais forte à mais fraca. */
function upsert(list: readonly BleScanResult[], found: BleScanResult): BleScanResult[] {
  const next = list.filter((item) => item.deviceId !== found.deviceId);
  next.push(found);
  return next.sort((a, b) => b.rssi - a.rssi);
}

export interface BluetoothHeartRateMonitoringProps {
  ble?: BleHeartRate;
  store?: BandChoiceStore;
  permissions?: BluetoothPermissions;
}

export function BluetoothHeartRateMonitoring({
  ble = bleHeartRate,
  store = sharedBandChoiceStore(),
  permissions = bluetoothPermissions,
}: BluetoothHeartRateMonitoringProps) {
  const theme = useTheme();
  const choice = useBandChoice(store);
  const startProblem = useBluetoothStartProblem();
  // O batimento anda sem evento: com a pulseira escolhida, o status é relido
  // a cada 2 s e a cada mudança de estado avisada pelo serviço. Sem pulseira
  // escolhida, ou fora da tela, ninguém consulta a ponte.
  const [change, setChange] = useState<BleStateChangedEvent | null>(null);
  useEffect(() => ble.onStateChanged(setChange), [ble]);
  const [, setPollTick] = useState(0);
  const escolhida = choice != null;
  useEffect(() => {
    if (!escolhida) return;
    const timer = setInterval(() => setPollTick((tick) => tick + 1), STATUS_POLL_MS);
    return () => clearInterval(timer);
  }, [escolhida]);

  const [phase, setPhase] = useState<ScanPhase>('idle');
  const [found, setFound] = useState<BleScanResult[]>([]);
  const [problem, setProblem] = useState<ScanProblem | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);
  const [endFailed, setEndFailed] = useState(false);
  // Segura o toque duplo enquanto a folha de permissão está aberta.
  const asking = useRef(false);
  // A varredura repete o anúncio várias vezes por segundo, e o ouvinte só sai
  // no commit da troca de fase: escolher fecha a lista na hora, senão um
  // anúncio tardio a traz de volta depois de limpa.
  const listening = useRef(false);

  // A varredura vive enquanto a fase é `scanning`: ouvinte antes do `scan`,
  // para não perder o primeiro resultado, e a limpeza para tudo (escolha,
  // Parar de procurar, 30 s, saída da tela).
  useEffect(() => {
    if (phase !== 'scanning') return;
    listening.current = true;
    const unsubscribe = ble.onScanResult((result) => {
      if (listening.current) setFound((list) => upsert(list, result));
    });
    ble.scan().catch((error: unknown) => {
      setProblem(scanProblemOf(error));
      setPhase('idle');
    });
    const timer = setTimeout(() => setPhase('done'), SCAN_TIMEOUT_MS);
    return () => {
      listening.current = false;
      clearTimeout(timer);
      unsubscribe();
      ble.stopScan();
    };
  }, [phase, ble]);

  if (!ble.supported) return null;

  const procurar = async () => {
    if (asking.current) return;
    asking.current = true;
    setProblem(null);
    setSaveFailed(false);
    try {
      const answer = await permissions.request();
      if (answer !== 'granted') {
        setProblem(answer);
        return;
      }
      setFound([]);
      setPhase('scanning');
    } finally {
      asking.current = false;
    }
  };

  const escolher = async (deviceId: string) => {
    const result = found.find((item) => item.deviceId === deviceId);
    if (!result) return;
    listening.current = false;
    setPhase((current) => (current === 'scanning' ? 'done' : current));
    setSaveFailed(false);
    try {
      await store.choose({ deviceId: result.deviceId, name: result.name });
    } catch {
      setSaveFailed(true);
      return;
    }
    setFound([]);
    setPhase('idle');
  };

  // Encerrar apaga a escolha; o ciclo de vida vê a escolha sumir e desliga a
  // escuta. Para voltar, a pessoa escolhe a pulseira de novo.
  const encerrar = async () => {
    setEndFailed(false);
    try {
      await store.end();
    } catch {
      setEndFailed(true);
    }
  };

  const status = ble.status();
  // O serviço ainda com a pulseira anterior (trocada há pouco) não diz nada
  // da escolhida: até religar, ela aparece só como escolhida.
  const daEscolhida = choice != null && status.deviceId === choice.deviceId;
  const nome = choice ? bandNameCopy(choice.name, choice.deviceId) : null;
  const etiqueta = nome !== null ? linkTagCopy(daEscolhida ? status.state : 'idle', nome) : null;
  const direto = daEscolhida ? directReadingOf(status, change, Date.now()) : null;

  const varrendo = phase === 'scanning';
  const pedeAjustes = problem === 'blocked' || startProblem === 'E_PERMISSION_DENIED';

  return (
    <View style={{ gap: theme.gap.l }}>
      <View style={{ gap: theme.gap.s }}>
        <Title variant="title.xs" color={theme.content.dark}>
          {COPY.titulo}
        </Title>
        <Text variant="body.s" color={theme.content.dark}>
          {COPY.corpo}
        </Text>
      </View>

      {/* Escolha ainda não lida: nada, para não dizer "nenhuma" à toa. */}
      {choice === null && !varrendo && (
        <Text variant="body.s" color={theme.content.dark}>
          {COPY.nenhuma}
        </Text>
      )}

      {etiqueta !== null && !varrendo && (
        <View style={{ gap: theme.gap.s }}>
          <StatusTag status={etiqueta.status} fullWidth numberOfLines={2} label={etiqueta.label} />
          {direto?.kind === 'bpm' && (
            <View style={{ gap: theme.gap.xs }}>
              <Text variant="caption.s" color={theme.content.dark}>
                {COPY.diretoDaPulseira}
              </Text>
              <Text variant="body.s" color={theme.content.dark}>
                {directBpmCopy(direto.bpm)}
              </Text>
            </View>
          )}
          {direto?.kind === 'waiting' && (
            <Text variant="body.s" color={theme.content.dark}>
              {COPY.aguardandoLeitura}
            </Text>
          )}
          {direto?.kind === 'disconnected' && (
            <Text variant="body.s" color={theme.content.dark}>
              {disconnectedSinceCopy(direto.since)}
            </Text>
          )}
        </View>
      )}

      {startProblem !== null && (
        <Text variant="body.s" color={theme.content.error}>
          {startProblemCopy(startProblem)}
        </Text>
      )}

      {varrendo && (
        <StatusTag status="info" fullWidth numberOfLines={2} label={COPY.procurando} />
      )}

      {found.length > 0 && (
        <RadioGroup
          label={COPY.listaTitulo}
          options={found.map((result) => ({ value: result.deviceId, label: scanOptionCopy(result) }))}
          value={null}
          onChange={(deviceId) => {
            void escolher(deviceId);
          }}
        />
      )}

      {phase === 'done' && found.length === 0 && (
        <Text variant="body.s" color={theme.content.dark}>
          {COPY.nadaEncontrado}
        </Text>
      )}

      {problem !== null && (
        <Text variant="body.s" color={theme.content.error}>
          {scanProblemCopy(problem)}
        </Text>
      )}

      {saveFailed && (
        <Text variant="body.s" color={theme.content.error}>
          {COPY.falhaGuardar}
        </Text>
      )}

      {endFailed && (
        <Text variant="body.s" color={theme.content.error}>
          {COPY.falhaEncerrar}
        </Text>
      )}

      <View style={{ gap: theme.gap.s }}>
        {varrendo ? (
          <Button variant="ghost" label={COPY.pararDeProcurar} fullWidth onPress={() => setPhase('done')} />
        ) : (
          <Button
            variant="outline"
            label={choice ? COPY.trocar : COPY.procurar}
            fullWidth
            onPress={() => {
              void procurar();
            }}
          />
        )}
        {choice && !varrendo && (
          <Button
            variant="ghost"
            label={COPY.encerrar}
            fullWidth
            onPress={() => {
              void encerrar();
            }}
          />
        )}
        {pedeAjustes && (
          <Button
            variant="ghost"
            label={COPY.abrirAjustes}
            fullWidth
            onPress={() => permissions.openSettings()}
          />
        )}
      </View>
    </View>
  );
}
