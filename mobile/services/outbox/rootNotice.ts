import type { WorkerTelemetry } from '../telemetry/myTelemetry';

// O aviso geral da área logada, por cima de qualquer tela. Um por vez, do mais
// urgente para o menos: o envio recusado (a pessoa precisa refazer), a falta
// de conexão (o que está na tela pode estar velho) e a bateria do relógio.

export type RootNotice =
  | { kind: 'refused' }
  /** `pending`: há envio parado numa tentativa que falhou. */
  | { kind: 'offline'; pending: boolean }
  | { kind: 'battery' };

export interface RootNoticeInput {
  /** Há recusa de envio na tela. */
  refused: boolean;
  /** Fila parada ou socket caído além da carência. */
  offline: boolean;
  /** A fila parou numa falha passageira com envio esperando. */
  stalled: boolean;
  /** A condição de bateria baixa do relógio está aberta. */
  battery: boolean;
  /**
   * Avisos que a pessoa fechou. `offline` vale até a conexão voltar;
   * `pending` até a fila andar ou esvaziar; `battery` até a condição fechar.
   */
  dismissed: { offline: boolean; pending: boolean; battery: boolean };
}

export function pickRootNotice({ refused, offline, stalled, battery, dismissed }: RootNoticeInput): RootNotice | null {
  if (refused) return { kind: 'refused' };
  if (offline) {
    // O envio parado avisa mesmo com o aviso sem envio já fechado: a ação da
    // jornada não marca nada na tela, e este é o único sinal de que ela ainda
    // não saiu. Fechado o aviso dos envios, a queda fica sem aviso.
    if (stalled) {
      if (!dismissed.pending) return { kind: 'offline', pending: true };
    } else if (!dismissed.offline) {
      return { kind: 'offline', pending: false };
    }
  }
  if (battery && !dismissed.battery) return { kind: 'battery' };
  return null;
}

export interface BatteryLow {
  /** A abertura da condição: a que fecha e reabre é outra, e avisa de novo. */
  key: string;
  percent: number | null;
}

/**
 * A condição de bateria baixa do relógio aberta na leitura. O número é o da
 * leitura atual, o mesmo que a tela de Estatísticas mostra; sem ela, o de
 * quando a condição abriu, que é o que a notificação do servidor diz.
 */
export function batteryLowOf(telemetry: WorkerTelemetry | null): BatteryLow | null {
  const open = telemetry?.conditions.find((c) => c.kind === 'DEVICE_BATTERY_LOW');
  if (!telemetry || !open) return null;
  const { battery } = telemetry.metrics;
  const value = battery.quality === 'CURRENT' && battery.value !== null ? battery.value : open.observedValue;
  return { key: open.openedAt, percent: value === null ? null : Math.round(value) };
}

/** O texto da notificação que o servidor manda ao funcionário, igual. */
export function batteryLowCopy(percent: number | null): { title: string; message: string } {
  return {
    title: 'Bateria do relógio baixa',
    message:
      percent === null
        ? 'Carregue o relógio para seguir monitorado.'
        : `Bateria em ${percent}%. Carregue o relógio para seguir monitorado.`,
  };
}
