import { act, create } from 'react-test-renderer';
import { createElement } from 'react';
import { useNow } from './useNow';

// Sem isto uma tela aberta segue dizendo "atual" para sempre depois que o Apple
// Watch para de enviar: a atualidade e funcao do relogio, nao de evento novo.

const probe = (intervalMs?: number) => {
  const vistos: number[] = [];
  function Probe() {
    vistos.push(useNow(intervalMs));
    return null;
  }
  return { Probe, vistos };
};

beforeEach(() => jest.useFakeTimers());
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('useNow', () => {
  it('avanca sozinho com o tempo, sem depender de evento novo', async () => {
    const { Probe, vistos } = probe(5_000);
    await act(async () => {
      create(createElement(Probe));
    });
    const inicial = vistos[vistos.length - 1];

    await act(async () => {
      jest.advanceTimersByTime(5_000);
    });

    expect(vistos[vistos.length - 1]).toBeGreaterThanOrEqual(inicial + 5_000);
  });

  it('desmontar para o relogio, para nao renderizar tela que saiu', async () => {
    const cancelar = jest.spyOn(globalThis, 'clearInterval');
    const { Probe } = probe(5_000);
    let tree!: ReturnType<typeof create>;
    await act(async () => {
      tree = create(createElement(Probe));
    });
    await act(async () => {
      tree.unmount();
    });
    expect(cancelar).toHaveBeenCalled();
  });
});
