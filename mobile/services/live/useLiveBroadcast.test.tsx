import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import type { LiveBroadcast, LiveBroadcastState } from './liveBroadcast';
import { useEndLiveOnLeave, useLiveBroadcast } from './useLiveBroadcast';

// Serviço de mentira com a mesma superfície do de verdade: o hook só lê o
// estado e repassa os toques.
function fakeStore(initial: LiveBroadcastState = { status: 'idle', notice: null }) {
  let state = initial;
  const listeners = new Set<() => void>();
  const store: LiveBroadcast & { set: (next: LiveBroadcastState) => void } = {
    getState: () => state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    start: jest.fn(async () => {}),
    stop: jest.fn(),
    toggle: jest.fn(),
    dismissNotice: jest.fn(),
    set(next) {
      state = next;
      for (const listener of [...listeners]) listener();
    },
  };
  return store;
}

type View = ReturnType<typeof useLiveBroadcast>;

function render(store: LiveBroadcast) {
  const seen: View[] = [];
  function Probe() {
    seen.push(useLiveBroadcast(store));
    return null;
  }
  let tree!: ReactTestRenderer;
  act(() => {
    tree = create(<Probe />);
  });
  return { seen, tree, last: () => seen[seen.length - 1] };
}

describe('useLiveBroadcast', () => {
  it('em repouso a câmera aparece inativa e sem aviso', () => {
    const { last } = render(fakeStore());
    expect(last().live).toBe(false);
    expect(last().notice).toBeNull();
  });

  it('só a transmissão aceita pelo servidor conta como ativa', () => {
    const store = fakeStore({ status: 'starting', notice: null });
    const { last } = render(store);
    expect(last().live).toBe(false);
    act(() => store.set({ status: 'live', notice: null }));
    expect(last().live).toBe(true);
  });

  it('o aviso acompanha o serviço', () => {
    const store = fakeStore();
    const { last } = render(store);
    act(() => store.set({ status: 'idle', notice: 'no-permission' }));
    expect(last().notice).toBe('no-permission');
    act(() => store.set({ status: 'idle', notice: 'failed' }));
    expect(last().notice).toBe('failed');
  });

  it('tocar e fechar o aviso vão direto ao serviço', () => {
    const store = fakeStore();
    const { last } = render(store);
    last().toggle();
    last().dismissNotice();
    expect(store.toggle).toHaveBeenCalledTimes(1);
    expect(store.dismissNotice).toHaveBeenCalledTimes(1);
  });

  it('a tela sair não desliga a transmissão: ela segue em qualquer tela', () => {
    const store = fakeStore({ status: 'live', notice: null });
    const { tree } = render(store);
    act(() => tree.unmount());
    expect(store.stop).not.toHaveBeenCalled();
  });
});

describe('useEndLiveOnLeave', () => {
  it('quem chama sair desliga a transmissão; enquanto está montado, não', () => {
    const store = fakeStore({ status: 'live', notice: null });
    function Root() {
      useEndLiveOnLeave(store);
      return null;
    }
    let tree!: ReactTestRenderer;
    act(() => {
      tree = create(<Root />);
    });
    act(() => tree.update(<Root />));
    expect(store.stop).not.toHaveBeenCalled();
    act(() => tree.unmount());
    expect(store.stop).toHaveBeenCalledTimes(1);
  });
});
