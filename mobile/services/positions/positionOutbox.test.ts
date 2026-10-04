import {
  createPositionOutbox,
  MAX_QUEUED_POINTS,
  shouldKeepPoint,
  type QueuedPoint,
} from './positionOutbox';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// Dublê do arquivo: um texto em memória com os dois verbos do real, como na
// suíte do telemetryOutbox. Reinício do app = outra fábrica sobre o mesmo dublê.
function memoryStorage(initial: string | null = null) {
  let text = initial;
  const read = jest.fn(async () => text);
  const write = jest.fn(async (next: string) => {
    text = next;
  });
  const storage: OutboxStorage = { read, write };
  return { storage, read, write, current: () => text };
}

const BASE = Date.parse('2026-10-04T12:00:00.000Z');
// Um grau de latitude tem cerca de 111 km: 0.0001 grau é uns 11 m.
function ponto(segundos: number, lat = -23.55, lng = -46.63): QueuedPoint {
  return { lat, lng, recordedAt: new Date(BASE + segundos * 1000).toISOString() };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  warn.mockRestore();
});

describe('shouldKeepPoint', () => {
  it('sem ponto anterior, guarda', () => {
    expect(shouldKeepPoint(null, ponto(0))).toBe(true);
  });

  it('parado, guarda só depois de 60 s', () => {
    expect(shouldKeepPoint(ponto(0), ponto(59))).toBe(false);
    expect(shouldKeepPoint(ponto(0), ponto(60))).toBe(true);
  });

  it('andando 25 m ou mais, guarda antes dos 60 s', () => {
    expect(shouldKeepPoint(ponto(0), ponto(5, -23.55 + 0.0003))).toBe(true);
    expect(shouldKeepPoint(ponto(0), ponto(5, -23.55 + 0.0001))).toBe(false);
  });

  it('ponto com a mesma hora ou mais velho não entra, mesmo longe', () => {
    expect(shouldKeepPoint(ponto(10), ponto(10, -23.6))).toBe(false);
    expect(shouldKeepPoint(ponto(10), ponto(5, -23.6))).toBe(false);
  });
});

describe('createPositionOutbox', () => {
  it('fila vazia sem arquivo', async () => {
    const { storage } = memoryStorage();
    expect(await createPositionOutbox(storage).pending('u1')).toEqual([]);
  });

  it('arquivo ilegível ou de forma errada é fila vazia', async () => {
    for (const text of ['{nao é json', '[]', '{"points":"x"}', 'null']) {
      const { storage } = memoryStorage(text);
      expect(await createPositionOutbox(storage).pending('u1')).toEqual([]);
    }
  });

  it('disco que falha na leitura é fila vazia', async () => {
    const storage: OutboxStorage = {
      read: async () => {
        throw new Error('disco');
      },
      write: async () => undefined,
    };
    expect(await createPositionOutbox(storage).pending('u1')).toEqual([]);
  });

  it('guarda só o que a regra de espaçamento deixa e sobrevive a reinício', async () => {
    const mem = memoryStorage();
    const fila = createPositionOutbox(mem.storage);
    const entraram = await fila.append('u1', [ponto(0), ponto(10), ponto(60), ponto(61)]);
    expect(entraram).toBe(2);
    const depois = createPositionOutbox(mem.storage);
    expect(await depois.pending('u1')).toEqual([ponto(0), ponto(60)]);
  });

  it('o espaçamento vale contra o último guardado mesmo depois de enviado', async () => {
    const mem = memoryStorage();
    const fila = createPositionOutbox(mem.storage);
    await fila.append('u1', [ponto(0)]);
    await fila.remove('u1', [ponto(0).recordedAt]);
    expect(await fila.append('u1', [ponto(30)])).toBe(0);
    expect(await fila.append('u1', [ponto(60)])).toBe(1);
  });

  it('ponto fora do contrato é recusado com aviso e não entra', async () => {
    const { storage } = memoryStorage();
    const fila = createPositionOutbox(storage);
    const ruins = [
      { lat: 91, lng: 0, recordedAt: ponto(0).recordedAt },
      { lat: 0, lng: -181, recordedAt: ponto(0).recordedAt },
      { lat: Number.NaN, lng: 0, recordedAt: ponto(0).recordedAt },
      { lat: 0, lng: 0, recordedAt: 'ontem' },
      { lat: 0, lng: 0, recordedAt: '2026-13-45T00:00:00.000Z' },
    ];
    expect(await fila.append('u1', ruins)).toBe(0);
    expect(await fila.pending('u1')).toEqual([]);
    expect(warn).toHaveBeenCalledTimes(ruins.length);
  });

  it('lote sem nada aproveitável não escreve', async () => {
    const mem = memoryStorage();
    const fila = createPositionOutbox(mem.storage);
    await fila.append('u1', []);
    expect(mem.write).not.toHaveBeenCalled();
  });

  it('pontos de outro dono são descartados ao gravar e ao ler', async () => {
    const mem = memoryStorage();
    const fila = createPositionOutbox(mem.storage);
    await fila.append('u1', [ponto(0)]);
    expect(await fila.pending('u2')).toEqual([]);
    // A leitura do outro dono já apagou os de u1: eles nunca saem com o token de u2.
    expect(await fila.pending('u1')).toEqual([]);

    await fila.append('u1', [ponto(100)]);
    await fila.append('u2', [ponto(200)]);
    expect(await fila.pending('u2')).toEqual([ponto(200)]);
  });

  it('o dono novo não herda o espaçamento do anterior', async () => {
    const { storage } = memoryStorage();
    const fila = createPositionOutbox(storage);
    await fila.append('u1', [ponto(0)]);
    expect(await fila.append('u2', [ponto(1)])).toBe(1);
  });

  it('remove só as horas citadas e ignora as desconhecidas', async () => {
    const mem = memoryStorage();
    const fila = createPositionOutbox(mem.storage);
    await fila.append('u1', [ponto(0), ponto(60), ponto(120)]);
    mem.write.mockClear();
    await fila.remove('u1', ['2020-01-01T00:00:00.000Z']);
    expect(mem.write).not.toHaveBeenCalled();
    await fila.remove('u1', [ponto(60).recordedAt]);
    expect(await fila.pending('u1')).toEqual([ponto(0), ponto(120)]);
  });

  it('remove de outro dono não toca a fila', async () => {
    const { storage } = memoryStorage();
    const fila = createPositionOutbox(storage);
    await fila.append('u1', [ponto(0)]);
    await fila.remove('u2', [ponto(0).recordedAt]);
    expect(await fila.pending('u1')).toEqual([ponto(0)]);
  });

  it('acima do teto, descarta os mais velhos', async () => {
    const { storage } = memoryStorage();
    const fila = createPositionOutbox(storage);
    const muitos = Array.from({ length: MAX_QUEUED_POINTS + 3 }, (_, i) => ponto(i * 60));
    await fila.append('u1', muitos);
    const pendentes = await fila.pending('u1');
    expect(pendentes).toHaveLength(MAX_QUEUED_POINTS);
    expect(pendentes[0]).toEqual(ponto(3 * 60));
  });

  it('chamadas concorrentes não se apagam', async () => {
    const { storage } = memoryStorage();
    const fila = createPositionOutbox(storage);
    await Promise.all([fila.append('u1', [ponto(0)]), fila.append('u1', [ponto(60)])]);
    expect(await fila.pending('u1')).toEqual([ponto(0), ponto(60)]);
  });

  it('uma escrita que falha não trava as seguintes', async () => {
    const mem = memoryStorage();
    mem.write.mockRejectedValueOnce(new Error('disco cheio'));
    const fila = createPositionOutbox(mem.storage);
    await expect(fila.append('u1', [ponto(0)])).rejects.toThrow('disco cheio');
    await fila.append('u1', [ponto(60)]);
    expect(await fila.pending('u1')).toEqual([ponto(60)]);
  });
});
