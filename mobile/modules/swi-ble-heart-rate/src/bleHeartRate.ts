import { requireOptionalNativeModule } from 'expo-modules-core';
import {
  BLE_HEART_RATE_STATES,
  type BleHeartRate,
  type BleHeartRateState,
  type BleHeartRateStatus,
  type BleScanResult,
  type BleStateChangedEvent,
  type ConnectedInterval,
  type RawHeartRateReading,
  type SwiBleHeartRateNative,
} from './SwiBleHeartRate.types';

// O módulo só existe compilado no Android. No iOS, na web, no Expo Go e no
// Jest ele não está registrado e a função devolve null: o app segue
// funcionando e a tela mostra "sem suporte" em vez de quebrar.
export function loadNativeBleHeartRate(platformOS: string): SwiBleHeartRateNative | null {
  if (platformOS !== 'android') return null;
  return requireOptionalNativeModule<SwiBleHeartRateNative>('SwiBleHeartRate');
}

const BLUETOOTH_SCAN = 'android.permission.BLUETOOTH_SCAN';
const BLUETOOTH_CONNECT = 'android.permission.BLUETOOTH_CONNECT';
const ACCESS_FINE_LOCATION = 'android.permission.ACCESS_FINE_LOCATION';

/**
 * Permissões que a tela pede antes de `scan` e `start`. Do Android 12 (API 31)
 * em diante a varredura tem permissão própria, declarada sem uso de
 * localização; do 8 ao 11 o sistema só entrega resultados com a localização
 * precisa concedida.
 */
export function requiredBluetoothPermissions(apiLevel: number): string[] {
  return apiLevel >= 31 ? [BLUETOOTH_SCAN, BLUETOOTH_CONNECT] : [ACCESS_FINE_LOCATION];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const isPositiveFinite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value > 0;

const nonEmptyString = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

const stateOf = (value: unknown): BleHeartRateState | null =>
  typeof value === 'string' && BLE_HEART_RATE_STATES.has(value) ? (value as BleHeartRateState) : null;

// O Kotlin entrega mapas sem tipo. Só passa o que tem a forma do contrato:
// uma leitura torta é descartada aqui, e não vira batimento inventado adiante.
function sanitizeReading(raw: unknown): RawHeartRateReading | null {
  if (!isRecord(raw)) return null;
  const bytes = nonEmptyString(raw.bytes);
  if (bytes === null || !isPositiveFinite(raw.receivedAt)) return null;
  return { bytes, receivedAt: raw.receivedAt };
}

function sanitizeInterval(raw: unknown): ConnectedInterval | null {
  if (!isRecord(raw) || !isPositiveFinite(raw.start)) return null;
  if (raw.end === null || raw.end === undefined) return { start: raw.start, end: null };
  if (!isPositiveFinite(raw.end) || raw.end < raw.start) return null;
  return { start: raw.start, end: raw.end };
}

function sanitizeScanResult(raw: unknown): BleScanResult | null {
  if (!isRecord(raw)) return null;
  const deviceId = nonEmptyString(raw.deviceId);
  if (deviceId === null) return null;
  if (typeof raw.rssi !== 'number' || !Number.isFinite(raw.rssi)) return null;
  return { deviceId, name: nonEmptyString(raw.name), rssi: raw.rssi };
}

function sanitizeStateEvent(raw: unknown): BleStateChangedEvent | null {
  if (!isRecord(raw)) return null;
  const state = stateOf(raw.state);
  if (state === null || !isPositiveFinite(raw.changedAt)) return null;
  return { state, deviceId: nonEmptyString(raw.deviceId), changedAt: raw.changedAt };
}

const IDLE_STATUS: BleHeartRateStatus = {
  state: 'idle',
  deviceId: null,
  lastReadingAt: null,
  lastBytes: null,
};

function sanitizeStatus(raw: unknown): BleHeartRateStatus {
  if (!isRecord(raw)) return IDLE_STATUS;
  return {
    // Estado fora do contrato é tratado como parado, que é o que a tela sabe
    // mostrar sem prometer conexão que ninguém confirmou.
    state: stateOf(raw.state) ?? 'idle',
    deviceId: nonEmptyString(raw.deviceId),
    lastReadingAt: isPositiveFinite(raw.lastReadingAt) ? raw.lastReadingAt : null,
    // Só a forma: se é batimento quem diz é o interpretador do perfil.
    lastBytes: nonEmptyString(raw.lastBytes),
  };
}

function sanitizeList<T>(read: () => unknown, sanitize: (raw: unknown) => T | null): T[] {
  try {
    const raw = read();
    if (!Array.isArray(raw)) return [];
    return raw.flatMap((item) => {
      const clean = sanitize(item);
      return clean === null ? [] : [clean];
    });
  } catch {
    // Uma falha aqui não pode derrubar a drenagem nem o leitor do Health
    // Connect: sem lista, a rodada simplesmente não tem o que fazer.
    return [];
  }
}

const unsupportedError = () =>
  Object.assign(new Error('Módulo de Bluetooth indisponível nesta plataforma'), {
    code: 'E_UNSUPPORTED',
  });

const UNSUPPORTED: BleHeartRate = {
  supported: false,
  // Rejeita em vez de resolver: sem módulo não houve varredura nem conexão.
  scan: async () => {
    throw unsupportedError();
  },
  stopScan: () => undefined,
  start: async () => {
    throw unsupportedError();
  },
  stop: async () => undefined,
  rotateReadings: () => [],
  connectedIntervals: () => [],
  status: () => IDLE_STATUS,
  onScanResult: () => () => undefined,
  onStateChanged: () => () => undefined,
};

export function createBleHeartRate(native: SwiBleHeartRateNative | null): BleHeartRate {
  if (!native) return UNSUPPORTED;
  return {
    supported: true,
    // Sem try/catch de propósito: o código da rejeição é a informação, e a
    // tela mapeia cada um para o próprio texto.
    scan: () => native.scan(),
    stopScan: () => native.stopScan(),
    async start(deviceId) {
      if (nonEmptyString(deviceId) === null) {
        throw new Error('Pulseira sem endereço');
      }
      return native.start(deviceId);
    },
    stop: () => native.stop(),
    rotateReadings: () => sanitizeList(() => native.rotateReadings(), sanitizeReading),
    connectedIntervals: (sinceMs) =>
      sanitizeList(() => native.connectedIntervals(sinceMs), sanitizeInterval),
    status() {
      try {
        return sanitizeStatus(native.status());
      } catch {
        return IDLE_STATUS;
      }
    },
    onScanResult(listener) {
      const subscription = native.addListener('onScanResult', (event) => {
        const clean = sanitizeScanResult(event);
        if (clean) listener(clean);
      });
      return () => subscription.remove();
    },
    onStateChanged(listener) {
      const subscription = native.addListener('onStateChanged', (event) => {
        const clean = sanitizeStateEvent(event);
        if (clean) listener(clean);
      });
      return () => subscription.remove();
    },
  };
}
