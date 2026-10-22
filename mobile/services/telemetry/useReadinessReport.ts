import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Platform } from 'react-native';
import { isFeatureEnabled } from '../../lib/featureFlags';
import {
  bleHeartRate,
  type BleHeartRate,
  type ConnectedInterval,
} from '../../modules/swi-ble-heart-rate/src';
import type { WatchControl } from '../../modules/swi-watch-control';
import { androidDeviceControl } from './android/androidDeviceControl';
import {
  listenerSinceOf,
  readinessReportOf,
  sendReadinessReport,
  type ListenerSnapshot,
  type ReadinessReport,
} from './readinessReport';
import { useTelemetryUploadState } from './TelemetryUploadProvider';
import { useReadinessFacts } from './useReadiness';

// O relato de prontidão ligado às fontes do app: os mesmos fatos da lista de
// prontidão (useReadinessFacts), a última sincronização e a última falha do
// leitor do Health Connect (contexto do envio) e o estado da escuta da
// pulseira (ponte do Bluetooth). Montado na área autenticada, para não
// depender de tela aberta. Só no Android com o gate do Health Connect.
//
// Sai quando algum fato muda, o que inclui cada sincronização: toda rodada
// do leitor move a última sincronização ou a última falha. A última leitura
// da pulseira não é gatilho (seria um envio por notificação); vai junto,
// lida na hora do envio. Falha de rede não derruba nada: o próximo gatilho
// manda o relato de então. O 401 segue o caminho do aparelho revogado: a
// credencial sai e o envio relê o pareamento.

export interface ReadinessReportDeps {
  control?: WatchControl;
  ble?: BleHeartRate;
  apiUrl?: () => string;
}

// Os trechos conectados de até 48 h, a mesma janela do leitor do Health
// Connect. O trecho aberto sempre vem, seja de quando for.
const INTERVALS_WINDOW_MS = 48 * 60 * 60 * 1000;

function intervalsOf(ble: BleHeartRate): ConnectedInterval[] {
  try {
    return ble.connectedIntervals(Date.now() - INTERVALS_WINDOW_MS);
  } catch {
    return [];
  }
}

function snapshotOf(ble: BleHeartRate): ListenerSnapshot {
  const { state } = ble.status();
  return { state, since: listenerSinceOf(state, intervalsOf(ble)) };
}

/** O estado da escuta, lido ao montar e seguido pelos eventos da ponte. */
function useListener(ble: BleHeartRate, enabled: boolean): ListenerSnapshot | null {
  // Lido já no primeiro render, para o primeiro relato não sair sem ele.
  const [snapshot, setSnapshot] = useState<ListenerSnapshot | null>(() =>
    enabled ? snapshotOf(ble) : null,
  );
  useEffect(() => {
    if (!enabled) {
      setSnapshot(null);
      return undefined;
    }
    setSnapshot(snapshotOf(ble));
    return ble.onStateChanged((event) => setSnapshot({ state: event.state, since: event.changedAt }));
  }, [ble, enabled]);
  return snapshot;
}

const withLastReading = (report: ReadinessReport, ble: BleHeartRate): ReadinessReport => {
  if (report.bluetooth.listenerState === null) return report;
  const { lastReadingAt } = ble.status();
  return {
    ...report,
    bluetooth: {
      ...report.bluetooth,
      lastReadingAt: lastReadingAt === null ? null : new Date(lastReadingAt).toISOString(),
    },
  };
};

export function useReadinessReport({
  control = androidDeviceControl,
  ble = bleHeartRate,
  apiUrl,
}: ReadinessReportDeps = {}): void {
  const active = Platform.OS === 'android' && isFeatureEnabled('healthConnect');
  const listens = active && isFeatureEnabled('bluetoothHeartRate') && ble.supported;
  const { paired, healthConnect, refreshPairing } = useTelemetryUploadState();
  const facts = useReadinessFacts();
  const listener = useListener(ble, listens);
  // Antes de o leitor e a escolha da pulseira serem lidos, o relato só
  // diria "não sei" e apagaria no painel o último que dizia algo.
  const known = healthConnect !== null && facts.bandChosen !== null;

  // O mesmo objeto enquanto o conteúdo não muda: o perfil, por exemplo,
  // muda os fatos sem mudar o relato, e não é motivo para enviar.
  const key = JSON.stringify(readinessReportOf({ facts, healthConnect, listener, lastReadingAt: null }));
  const report = useMemo(() => JSON.parse(key) as ReadinessReport, [key]);

  // O que a drenagem usa, sempre o de agora.
  const deps = useRef({ control, ble, apiUrl, refreshPairing });
  deps.current = { control, ble, apiUrl, refreshPairing };
  // Um envio por vez, na ordem: um relato mais velho chegando depois
  // apagaria o mais novo. O que muda durante um envio espera, e só o mais
  // recente sai.
  const pending = useRef<ReadinessReport | null>(null);
  const sending = useRef(false);

  const drain = useCallback(async () => {
    if (sending.current) return;
    sending.current = true;
    try {
      for (let next = pending.current; next !== null; next = pending.current) {
        pending.current = null;
        const current = deps.current;
        const outcome = await sendReadinessReport(withLastReading(next, current.ble), {
          control: current.control,
          apiUrl: current.apiUrl,
        });
        if (outcome === 'unpaired') {
          pending.current = null;
          current.refreshPairing();
        }
      }
    } finally {
      sending.current = false;
    }
  }, []);

  useEffect(() => {
    if (!active || !paired || !known) return;
    pending.current = report;
    void drain();
  }, [active, paired, known, report, drain]);
}
