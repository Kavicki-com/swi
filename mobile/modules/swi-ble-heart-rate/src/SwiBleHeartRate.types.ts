// Contrato entre o módulo nativo do Android (pulseira pelo perfil padrão de
// batimento, serviço 0x180D) e o JavaScript. O nativo varre, conecta, assina
// o 0x2A37 e guarda cada notificação crua numa caixa de entrada; não
// interpreta nada. A interpretação dos bytes, os descartes e o envio são do
// JavaScript.

/**
 * Estado da ligação com a pulseira escolhida.
 *
 * - `idle`: serviço parado (nenhuma pulseira escolhida, ou depois do `stop`).
 * - `searching`: serviço de pé, pulseira fora de alcance ou desligada; o
 *   sistema religa sozinho quando ela voltar a anunciar.
 * - `connected`: conectada e com o 0x2A37 assinado.
 * - `bluetoothOff`: serviço de pé esperando o Bluetooth do celular voltar.
 */
export type BleHeartRateState = 'idle' | 'searching' | 'connected' | 'bluetoothOff';

export const BLE_HEART_RATE_STATES: ReadonlySet<string> = new Set<BleHeartRateState>([
  'idle',
  'searching',
  'connected',
  'bluetoothOff',
]);

/** Uma pulseira vista na varredura. */
export interface BleScanResult {
  /** Endereço Bluetooth, que é o que se guarda e se passa ao `start`. */
  deviceId: string;
  /** Nome anunciado; null quando a pulseira não anuncia nome. */
  name: string | null;
  /** Intensidade do sinal em dBm (negativo; mais perto de zero é mais perto). */
  rssi: number;
}

export interface BleStateChangedEvent {
  state: BleHeartRateState;
  /** Pulseira em uso; null com o serviço parado. */
  deviceId: string | null;
  /** Milissegundos desde a época, no relógio do celular. */
  changedAt: number;
}

export interface SwiBleHeartRateEvents {
  onScanResult: BleScanResult;
  onStateChanged: BleStateChangedEvent;
}

export interface BleHeartRateStatus {
  state: BleHeartRateState;
  /** Pulseira guardada para religar; null antes da primeira escolha. */
  deviceId: string | null;
  /** Última notificação recebida, em ms desde a época; null se nenhuma. */
  lastReadingAt: number | null;
  /**
   * Bytes da última notificação do 0x2A37, em base64, para a tela de escolher
   * a pulseira mostrar o valor. Só em memória no Kotlin: null depois de o
   * processo reiniciar, antes da primeira notificação e no módulo de versão
   * anterior, que não manda o campo.
   */
  lastBytes?: string | null;
}

/**
 * Uma notificação do 0x2A37 como chegou: os bytes em base64 e a hora do
 * recebimento no celular (ms desde a época). A pulseira não manda horário.
 */
export interface RawHeartRateReading {
  bytes: string;
  receivedAt: number;
}

/**
 * Período em que a pulseira ficou conectada e assinada. `end` null quando a
 * conexão segue aberta. Serve para o leitor do Health Connect descartar o
 * batimento desses trechos, que já veio pelo Bluetooth.
 */
export interface ConnectedInterval {
  start: number;
  end: number | null;
}

/**
 * Códigos com que `scan` e `start` rejeitam. Os quatro primeiros vêm do
 * Kotlin; o último é do invólucro, quando não há módulo compilado.
 *
 * - `E_PERMISSION_DENIED`: falta BLUETOOTH_SCAN ou BLUETOOTH_CONNECT
 *   (Android 12 ou mais) ou a localização precisa (Android 8 a 11). No
 *   Android 14 o serviço `connectedDevice` sem BLUETOOTH_CONNECT derrubaria o
 *   app: o nativo confere antes e devolve este código.
 * - `E_BLUETOOTH_OFF`: Bluetooth do celular desligado (só na varredura; o
 *   serviço já de pé espera o Bluetooth voltar).
 * - `E_BLUETOOTH_UNAVAILABLE`: aparelho sem Bluetooth de baixa energia.
 * - `E_START_FAILED`: o sistema recusou subir o serviço em primeiro plano
 *   (por exemplo, pedido com o app em segundo plano).
 * - `E_UNSUPPORTED`: módulo ausente (iOS, web, Jest, Expo Go).
 */
export type BleHeartRateErrorCode =
  | 'E_PERMISSION_DENIED'
  | 'E_BLUETOOTH_OFF'
  | 'E_BLUETOOTH_UNAVAILABLE'
  | 'E_START_FAILED'
  | 'E_UNSUPPORTED';

const BLE_HEART_RATE_ERROR_CODES: ReadonlySet<string> = new Set<BleHeartRateErrorCode>([
  'E_PERMISSION_DENIED',
  'E_BLUETOOTH_OFF',
  'E_BLUETOOTH_UNAVAILABLE',
  'E_START_FAILED',
  'E_UNSUPPORTED',
]);

/** Lê o código de uma rejeição de `scan` ou `start`; null se não for do contrato. */
export function bleHeartRateErrorCode(error: unknown): BleHeartRateErrorCode | null {
  if (typeof error !== 'object' || error === null) return null;
  const { code } = error as { code?: unknown };
  if (typeof code !== 'string' || !BLE_HEART_RATE_ERROR_CODES.has(code)) return null;
  return code as BleHeartRateErrorCode;
}

export type Unsubscribe = () => void;

/** O que o Kotlin expõe, sem garantia de forma: o invólucro saneia tudo. */
export interface SwiBleHeartRateNative {
  scan(): Promise<void>;
  stopScan(): void;
  start(deviceId: string): Promise<void>;
  stop(): Promise<void>;
  /** Devolve tudo o que está na caixa de entrada e a esvazia. */
  rotateReadings(): unknown;
  /** Intervalos conectados que terminam depois de `sinceMs` (ou seguem abertos). */
  connectedIntervals(sinceMs: number): unknown;
  status(): unknown;
  addListener<K extends keyof SwiBleHeartRateEvents>(
    eventName: K,
    listener: (event: SwiBleHeartRateEvents[K]) => void,
  ): { remove(): void };
}

/** A ponte que os serviços e telas usam. */
export interface BleHeartRate {
  /** false fora do Android compilado; aí tudo é inerte. */
  supported: boolean;
  /** Começa a varrer pulseiras que anunciam o 0x180D. Rejeita com código. */
  scan(): Promise<void>;
  stopScan(): void;
  /**
   * Guarda a pulseira, sobe o serviço em primeiro plano e conecta. Depois de
   * um `start`, o sistema religa o serviço sozinho até o `stop`.
   */
  start(deviceId: string): Promise<void>;
  /** Para o serviço e solta a conexão. A pulseira escolhida fica guardada. */
  stop(): Promise<void>;
  rotateReadings(): RawHeartRateReading[];
  connectedIntervals(sinceMs: number): ConnectedInterval[];
  status(): BleHeartRateStatus;
  onScanResult(listener: (result: BleScanResult) => void): Unsubscribe;
  onStateChanged(listener: (event: BleStateChangedEvent) => void): Unsubscribe;
}
