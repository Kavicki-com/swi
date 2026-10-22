import { useEffect, useSyncExternalStore } from 'react';
import { File, Paths } from 'expo-file-system';
import type { OutboxStorage } from '../telemetryOutbox';

// A pulseira que a pessoa escolheu em Configurações > Monitoramento. Fica no
// JavaScript, e não só no nativo, porque a escolha acontece fora da jornada:
// o nativo só guarda o endereço quando o serviço sobe (`start`), e escolher
// não pode subir serviço nenhum. O ciclo de vida (useBluetoothHeartRate.ts)
// lê daqui o endereço que passa ao `start`; a tela, o nome que mostra.

export const BAND_CHOICE_FILE_NAME = 'bluetooth-band.json';

export interface BandChoice {
  /** Endereço Bluetooth visto na varredura; é o que vai ao `start`. */
  deviceId: string;
  /** Nome anunciado; null quando a pulseira não anuncia nome. */
  name: string | null;
}

export interface BandChoiceStore {
  /** `undefined` antes de o arquivo ser lido; `null` sem pulseira escolhida. */
  current(): BandChoice | null | undefined;
  /** Lê o arquivo. Rejeita se o disco falhar, e a escolha segue desconhecida. */
  load(): Promise<BandChoice | null>;
  /** Grava e só então troca. Rejeita se não gravar: a pessoa precisa saber. */
  choose(choice: BandChoice): Promise<void>;
  subscribe(listener: () => void): () => void;
}

const nonEmpty = (value: unknown): string | null =>
  typeof value === 'string' && value.trim() !== '' ? value : null;

function parseChoice(text: string | null): BandChoice | null {
  if (text === null || text === '') return null;
  try {
    const raw: unknown = JSON.parse(text);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return null;
    const { deviceId, name } = raw as Record<string, unknown>;
    const id = nonEmpty(deviceId);
    return id === null ? null : { deviceId: id, name: nonEmpty(name) };
  } catch {
    return null;
  }
}

export function createBandChoiceStore(storage: OutboxStorage): BandChoiceStore {
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
    async choose(next) {
      await storage.write(JSON.stringify(next));
      set(next);
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
