import { useEffect, useRef, useState } from 'react';
import { View } from 'react-native';
import { Button, RadioGroup, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system';
import {
  bleHeartRate,
  bleHeartRateErrorCode,
  type BleHeartRate,
  type BleScanResult,
} from '../../modules/swi-ble-heart-rate/src';
import {
  sharedBandChoiceStore,
  useBandChoice,
  type BandChoiceStore,
} from '../../services/telemetry/bluetooth/bluetoothBandChoice';
import {
  BLUETOOTH_MONITORING_COPY as COPY,
  bandNameCopy,
  lastReadingCopy,
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
import { useBluetoothStartProblem } from '../../services/telemetry/bluetooth/useBluetoothHeartRate';
import { useNow } from '../../services/telemetry/useNow';

// A pulseira no Bluetooth em Configurações > Monitoramento, abaixo do Health
// Connect: escolher uma vez a pulseira que transmite pelo perfil padrão de
// batimento (0x180D), trocar, encerrar, ver o estado da ligação e o último
// batimento. Escolher é ativar o monitoramento e Encerrar o termina; quem
// liga e desliga o serviço com essa escolha é o ciclo de vida
// (useBluetoothHeartRate.ts). Mora fora de `app/` porque tudo ali vira rota
// no Expo Router; aqui só compõe o DS.
//
// A varredura pede as permissões antes (a folha do sistema), roda no máximo
// 30 s e para ao escolher, ao tocar Parar de procurar e ao sair da tela:
// varrer gasta bateria e, no Android, tem cota por app.

export const SCAN_TIMEOUT_MS = 30_000;

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
  // O último batimento anda sem evento: o status é relido a cada volta do
  // relógio e a cada mudança de estado avisada pelo serviço.
  useNow();
  const [, setStateTick] = useState(0);
  useEffect(() => ble.onStateChanged(() => setStateTick((tick) => tick + 1)), [ble]);

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
  const ultimo = daEscolhida && status.lastReadingAt !== null ? status.lastReadingAt : null;

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
          {ultimo !== null && (
            <Text variant="body.s" color={theme.content.dark}>
              {lastReadingCopy(ultimo)}
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
