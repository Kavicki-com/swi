import { useEffect, useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';
import type { OutboxStorage } from '../telemetryOutbox';

// A pulseira que a pessoa escolheu em Configurações > Monitoramento. Escolher
// é ativar o monitoramento: o ciclo de vida (useBluetoothHeartRate.ts) liga a
// escuta com o endereço daqui, e a drenagem (bluetoothInboxDrain.ts) abre a
// sessão de monitoramento pela escolha. Encerrar apaga a escolha, e a escuta
// para. Fica no JavaScript, e não só no nativo, porque a tela, o ciclo de
// vida e a drenagem precisam ler a mesma escolha, também antes de o serviço
// subir.

export const BAND_CHOICE_FILE_NAME = 'bluetooth-band.json';

export interface BandChoice {
  /** Endereço Bluetooth visto na varredura; é o que vai ao `start`. */
  deviceId: string;
  /** Nome anunciado; null quando a pulseira não anuncia nome. */
  name: string | null;
  /**
   * Hora (ms) da escolha. Escolher de novo, mesmo a mesma pulseira, é outra
   * escolha e abre outra sessão de monitoramento. Ausente no arquivo, vale
   * como escolhida desde sempre.
   */
  chosenAt?: number;
}

/** O que a tela passa ao escolher; a hora é do armazenamento. */
export type BandPick = Pick<BandChoice, 'deviceId' | 'name'>;

export interface BandChoiceStore {
  /** `undefined` antes de o arquivo ser lido; `null` sem pulseira escolhida. */
  current(): BandChoice | null | undefined;
  /** Lê o arquivo. Rejeita se o disco falhar, e a escolha segue desconhecida. */
  load(): Promise<BandChoice | null>;
  /** Grava e só então troca. Rejeita se não gravar: a pessoa precisa saber. */
  choose(pick: BandPick): Promise<void>;
  /** Encerrar: apaga a escolha. Rejeita se não gravar, e a escolha fica. */
  end(): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

function parseChoice(text: string | null): BandChoice | null {
  if (text === null || text === '') return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { deviceId, name, chosenAt } = raw as Record<string, unknown>;
    const id = nonEmpty(deviceId);
    if (id === null) return null;
    const choice: BandChoice = { deviceId: id, name: nonEmpty(name) };
    if (typeof chosenAt === 'number' && Number.isFinite(chosenAt)) choice.chosenAt = chosenAt;
    return choice;
  } catch {
    return null;
  }
}

/**
 * A escolha guardada, lida direto do arquivo. É o que a drenagem usa: roda
 * sem tela e não deve avisar a tela a cada rodada. Rejeita se o disco falhar.
 */
export async function readBandChoice(storage: OutboxStorage): Promise<BandChoice | null> {
  return parseChoice(await storage.read());
}

export function createBandChoiceStore(
  storage: OutboxStorage,
  now: () => number = Date.now,
): BandChoiceStore {
  let choice: BandChoice | null | undefined;
  const listeners = new Set<() => void>();
  const set = (next: BandChoice | null) => {
    choice = next;
    listeners.forEach((listener) => listener());
  };
  return {
    current: () => choice,
    async load() {
      const loaded = parseChoice(await storage.read());
      set(loaded);
      return loaded;
    },
    async choose(pick) {
      const next: BandChoice = { deviceId: pick.deviceId, name: pick.name, chosenAt: now() };
      await storage.write(JSON.stringify(next));
      set(next);
    },
    async end() {
      await storage.write('');
      set(null);
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/**
 * Armazenamento real, em `Paths.document`, no mesmo padrão do estado do
 * leitor do Health Connect: sobrevive a reinício, e o `File` é instanciado
 * aqui dentro para o módulo poder ser importado onde `expo-file-system` é
 * dublê.
 */
export function createFileBandChoiceStorage(): OutboxStorage {
  const file = new File(Paths.document, BAND_CHOICE_FILE_NAME);
  return {
    async read() {
      if (!file.exists) return null;
      return file.text();
    },
    async write(text) {
      if (!file.exists) file.create();
      file.write(text);
    },
  };
}

let shared: BandChoiceStore | null = null;

/** Instância única do runtime: a tela e o ciclo de vida veem a mesma escolha. */
export function sharedBandChoiceStore(): BandChoiceStore {
  shared ??= createBandChoiceStore(createFileBandChoiceStorage());
  return shared;
}

/** A escolha atual, lida do arquivo na primeira montagem. */
export function useBandChoice(
  store: BandChoiceStore = sharedBandChoiceStore(),
): BandChoice | null | undefined {
  const choice = useSyncExternalStore(store.subscribe, store.current);
  useEffect(() => {
    if (store.current() !== undefined) return;
    store.load().catch((error: unknown) => {
      // Desconhecida, o ciclo de vida não age: nem liga nem desliga.
      console.warn(`[bluetoothBandChoice] leitura falhou: ${String(error)}`);
    });
  }, [store]);
  return choice;
}
