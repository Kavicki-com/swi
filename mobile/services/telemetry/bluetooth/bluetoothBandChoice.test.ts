import { createElement } from 'react';
import {
  BAND_CHOICE_FILE_NAME,
  createBandChoiceStore,
  createFileBandChoiceStorage,
  useBandChoice,
  type BandChoice,
  type BandChoiceStore,
} from './bluetoothBandChoice';

const TestRenderer: {
  create: (el: unknown) => { update: (el: unknown) => void; unmount: () => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

// Disco de mentira para o armazenamento real: uri → texto.
const mockDisk = new Map<string, string>();
jest.mock('expo-file-system', () => {
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = parts
        .map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri))
        .join('/');
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    create() {
      mockDisk.set(this.uri, '');
    }
    write(text: string) {
      mockDisk.set(this.uri, text);
    }
    async text() {
      return mockDisk.get(this.uri) ?? '';
    }
  }
  return { File, Paths: { document: 'file:///doc' } };
});

function memoria(inicial: string | null = null) {
  const store = {
    text: inicial,
    read: jest.fn(async (): Promise<string | null> => store.text),
    write: jest.fn(async (text: string) => {
      store.text = text;
    }),
  };
  return store;
}

const POLAR: BandChoice = { deviceId: 'A0:9E:1A:00:00:01', name: 'Polar H10' };

describe('createBandChoiceStore', () => {
  it('antes de ler o arquivo, a escolha é desconhecida (undefined)', () => {
    const store = createBandChoiceStore(memoria());
    expect(store.current()).toBeUndefined();
  });

  it('sem arquivo, não há pulseira escolhida (null)', async () => {
    const store = createBandChoiceStore(memoria());
    expect(await store.load()).toBeNull();
    expect(store.current()).toBeNull();
  });

  it('lê a pulseira guardada', async () => {
    const store = createBandChoiceStore(memoria(JSON.stringify(POLAR)));
    expect(await store.load()).toEqual(POLAR);
    expect(store.current()).toEqual(POLAR);
  });

  it('arquivo ilegível ou de forma errada vale como nenhuma escolha', async () => {
    for (const texto of ['{', '[]', '{"deviceId":""}', '{"deviceId":3}', '']) {
      const store = createBandChoiceStore(memoria(texto));
      expect(await store.load()).toBeNull();
    }
  });

  it('nome ausente ou em branco vira null, sem perder a pulseira', async () => {
    const store = createBandChoiceStore(memoria(JSON.stringify({ deviceId: 'X', name: '  ' })));
    expect(await store.load()).toEqual({ deviceId: 'X', name: null });
  });

  it('disco que lança na leitura: a escolha segue desconhecida e o erro sobe', async () => {
    const disco = memoria();
    disco.read.mockRejectedValueOnce(new Error('disco'));
    const store = createBandChoiceStore(disco);
    await expect(store.load()).rejects.toThrow('disco');
    expect(store.current()).toBeUndefined();
  });

  it('escolher grava, atualiza na hora e avisa quem ouve', async () => {
    const disco = memoria();
    const store = createBandChoiceStore(disco);
    const ouvinte = jest.fn();
    store.subscribe(ouvinte);

    await store.choose(POLAR);

    expect(JSON.parse(disco.text ?? 'null')).toEqual(POLAR);
    expect(store.current()).toEqual(POLAR);
    expect(ouvinte).toHaveBeenCalled();
  });

  it('a gravação que falha não troca a escolha e rejeita', async () => {
    const disco = memoria(JSON.stringify(POLAR));
    const store = createBandChoiceStore(disco);
    await store.load();
    disco.write.mockRejectedValueOnce(new Error('cheio'));

    await expect(store.choose({ deviceId: 'B', name: null })).rejects.toThrow('cheio');
    expect(store.current()).toEqual(POLAR);
  });

  it('cancelar a inscrição para os avisos', async () => {
    const store = createBandChoiceStore(memoria());
    const ouvinte = jest.fn();
    const cancelar = store.subscribe(ouvinte);
    cancelar();
    await store.choose(POLAR);
    expect(ouvinte).not.toHaveBeenCalled();
  });
});

describe('createFileBandChoiceStorage', () => {
  beforeEach(() => mockDisk.clear());

  it('grava e lê em Paths.document, com o nome fixo', async () => {
    const storage = createFileBandChoiceStorage();
    expect(await storage.read()).toBeNull();
    await storage.write('{"deviceId":"X"}');
    expect(mockDisk.get(`file:///doc/${BAND_CHOICE_FILE_NAME}`)).toBe('{"deviceId":"X"}');
    expect(await storage.read()).toBe('{"deviceId":"X"}');
  });
});

describe('useBandChoice', () => {
  let visto: BandChoice | null | undefined;
  function Harness({ store }: { store: BandChoiceStore }) {
    visto = useBandChoice(store);
    return null;
  }

  it('começa desconhecida, lê o arquivo ao montar e acompanha a escolha', async () => {
    const store = createBandChoiceStore(memoria());
    await act(async () => {
      TestRenderer.create(createElement(Harness, { store }));
    });
    expect(visto).toBeNull();

    await act(async () => {
      await store.choose(POLAR);
    });
    expect(visto).toEqual(POLAR);
  });

  it('disco que lança ao montar não derruba a tela: a escolha segue desconhecida', async () => {
    const disco = memoria();
    disco.read.mockRejectedValueOnce(new Error('disco'));
    const store = createBandChoiceStore(disco);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    await act(async () => {
      TestRenderer.create(createElement(Harness, { store }));
    });
    expect(visto).toBeUndefined();
  });
});
