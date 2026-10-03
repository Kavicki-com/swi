// O hook que alimenta as camadas do mapa (colegas, calor): lê quando a camada
// liga, relê em cadência fixa e para quando ela desliga.
import { createElement, type ComponentType } from 'react';
import { usePolledRead, type PolledRead } from './usePolledRead';
// react-test-renderer ships no type declarations, tipa localmente (mesma nota
// do usePositionHeartbeat.test.ts).
const TestRenderer: {
  create: (el: unknown) => { unmount: () => void; update: (el: unknown) => void };
  act: (cb: () => void | Promise<void>) => void | Promise<void>;
} = require('react-test-renderer');
const act = TestRenderer.act;

let seen: PolledRead<string[]>;
let renders = 0;
function Harness({
  enabled,
  read,
  retryMs,
}: {
  enabled: boolean;
  read: () => Promise<string[]>;
  retryMs?: number;
}) {
  renders += 1;
  seen = usePolledRead(enabled, read, 1000, retryMs);
  return null;
}
const el = (enabled: boolean, read: () => Promise<string[]>, retryMs?: number) =>
  createElement(Harness as ComponentType<any>, { enabled, read, retryMs });

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe('usePolledRead', () => {
  it('desligado não lê nada e não tem dado', async () => {
    const read = jest.fn().mockResolvedValue(['a']);
    await act(async () => { TestRenderer.create(el(false, read)); });
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(read).not.toHaveBeenCalled();
    expect(seen).toEqual({ data: null, failed: false });
  });

  it('ligado lê na hora e relê a cada intervalo', async () => {
    const read = jest.fn().mockResolvedValueOnce(['a']).mockResolvedValue(['a', 'b']);
    await act(async () => { TestRenderer.create(el(true, read)); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ data: ['a'], failed: false });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(read).toHaveBeenCalledTimes(2);
    expect(seen.data).toEqual(['a', 'b']);
  });

  it('falha sem leitura anterior fica sem dado e marca a falha', async () => {
    const read = jest.fn().mockRejectedValue(new Error('403'));
    await act(async () => { TestRenderer.create(el(true, read)); });
    expect(seen).toEqual({ data: null, failed: true });
  });

  it('falha depois de uma leitura boa mantém o último dado e marca a falha', async () => {
    const read = jest.fn().mockResolvedValueOnce(['a']).mockRejectedValue(new Error('rede'));
    await act(async () => { TestRenderer.create(el(true, read)); });
    await act(async () => { jest.advanceTimersByTime(1000); });
    expect(seen).toEqual({ data: ['a'], failed: true });
  });

  it('desligar para o relógio e esquece o dado', async () => {
    const read = jest.fn().mockResolvedValue(['a']);
    let root!: { update: (el: unknown) => void };
    await act(async () => { root = TestRenderer.create(el(true, read)); });
    await act(async () => { root.update(el(false, read)); });
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(read).toHaveBeenCalledTimes(1);
    expect(seen).toEqual({ data: null, failed: false });
  });

  // Trocar de camada desligada para ligada de novo abre uma leitura nova; a
  // resposta da leitura antiga, se chegar depois, não pode pisar na tela.
  it('resposta de uma leitura já encerrada não é aplicada', async () => {
    const pendentes: ((v: string[]) => void)[] = [];
    const read = jest.fn(() => new Promise<string[]>((r) => { pendentes.push(r); }));
    let root!: { update: (el: unknown) => void };
    await act(async () => { root = TestRenderer.create(el(true, read)); });
    await act(async () => { root.update(el(false, read)); });
    const antes = renders;

    await act(async () => { pendentes[0](['tarde']); });

    expect(seen).toEqual({ data: null, failed: false });
    expect(renders).toBe(antes);
  });

  it('desmontar para de ler', async () => {
    const read = jest.fn().mockResolvedValue(['a']);
    let root!: { unmount: () => void };
    await act(async () => { root = TestRenderer.create(el(true, read)); });
    await act(async () => { root.unmount(); });
    await act(async () => { jest.advanceTimersByTime(5000); });
    expect(read).toHaveBeenCalledTimes(1);
  });

  describe('com prazo de nova tentativa', () => {
    it('depois de uma falha, tenta de novo no prazo curto em vez de esperar o intervalo', async () => {
      const read = jest.fn().mockRejectedValueOnce(new Error('rede')).mockResolvedValue(['a']);
      await act(async () => { TestRenderer.create(el(true, read, 100)); });
      expect(seen).toEqual({ data: null, failed: true });

      await act(async () => { jest.advanceTimersByTime(100); });

      expect(read).toHaveBeenCalledTimes(2);
      expect(seen).toEqual({ data: ['a'], failed: false });
    });

    it('leitura boa não agenda tentativa extra', async () => {
      const read = jest.fn().mockResolvedValue(['a']);
      await act(async () => { TestRenderer.create(el(true, read, 100)); });
      await act(async () => { jest.advanceTimersByTime(900); });
      expect(read).toHaveBeenCalledTimes(1);
    });

    it('falhas seguidas mantêm uma tentativa pendente só', async () => {
      const read = jest.fn().mockRejectedValue(new Error('rede'));
      await act(async () => { TestRenderer.create(el(true, read, 400)); });
      // 400 e 800: tentativas. 1000: intervalo. A falha do intervalo troca a
      // tentativa que estava marcada para 1200 por uma em 1400.
      await act(async () => { jest.advanceTimersByTime(400); });
      await act(async () => { jest.advanceTimersByTime(400); });
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(read).toHaveBeenCalledTimes(4);
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(read).toHaveBeenCalledTimes(4);
      await act(async () => { jest.advanceTimersByTime(200); });
      expect(read).toHaveBeenCalledTimes(5);
    });

    it('desligar cancela a tentativa pendente', async () => {
      const read = jest.fn().mockRejectedValue(new Error('rede'));
      let root!: { update: (el: unknown) => void };
      await act(async () => { root = TestRenderer.create(el(true, read, 100)); });
      await act(async () => { root.update(el(false, read, 100)); });
      await act(async () => { jest.advanceTimersByTime(5000); });
      expect(read).toHaveBeenCalledTimes(1);
    });
  });
});
