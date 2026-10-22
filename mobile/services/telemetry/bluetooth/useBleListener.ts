import { useEffect, useState } from 'react';
import type { BleHeartRate, ConnectedInterval } from '../../../modules/swi-ble-heart-rate/src';
import { listenerSinceOf, type ListenerSnapshot } from '../readinessReport';

// O estado da escuta da pulseira e desde quando, lido da ponte ao montar e
// seguido pelos eventos dela. Quem lê: o relato de prontidão ao backend
// (useReadinessReport.ts) e a ausência por métrica das telas de vitais
// (useAbsenceContext.ts), para os dois dizerem a mesma coisa.

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

/** O estado da escuta, ou null com `enabled` falso (sem o gate, sem a ponte). */
export function useBleListener(ble: BleHeartRate, enabled: boolean): ListenerSnapshot | null {
  // Lido já no primeiro render, para quem lê não começar sem ele.
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
