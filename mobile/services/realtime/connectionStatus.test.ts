import { CONNECTION_GRACE_MS, createConnectionStatus } from './connectionStatus';

// Dublê do socket do socket.io: só o que o armazém usa (on/off) e um emit
// para o teste disparar os eventos que o cliente real dispara.
function fakeSocket() {
  const handlers = new Map<string, Set<(...args: unknown[]) => void>>();
  return {
    on: jest.fn((event: string, h: (...args: unknown[]) => void) => {
      if (!handlers.has(event)) handlers.set(event, new Set());
      handlers.get(event)!.add(h);
    }),
    off: jest.fn((event: string, h: (...args: unknown[]) => void) => {
      handlers.get(event)?.delete(h);
    }),
    emit(event: string, ...args: unknown[]) {
      for (const h of [...(handlers.get(event) ?? [])]) h(...args);
    },
    listeners(event: string) {
      return handlers.get(event)?.size ?? 0;
    },
  };
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('a carência do app é de 10 segundos', () => {
  expect(CONNECTION_GRACE_MS).toBe(10_000);
});

it('sem socket registrado não há queda', () => {
  const status = createConnectionStatus();
  expect(status.isLost()).toBe(false);
});

it('socket que cai só conta como queda depois da carência', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');

  jest.advanceTimersByTime(CONNECTION_GRACE_MS - 1);
  expect(status.isLost()).toBe(false);
  jest.advanceTimersByTime(1);
  expect(status.isLost()).toBe(true);
});

it('avisa quem assina quando a queda começa e quando acaba', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const listener = jest.fn();
  status.subscribe(listener);
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'ping timeout');

  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(listener).toHaveBeenCalledTimes(1);
  expect(status.isLost()).toBe(true);

  socket.emit('connect');
  expect(listener).toHaveBeenCalledTimes(2);
  expect(status.isLost()).toBe(false);
});

it('quem cancela a assinatura não recebe mais aviso', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const listener = jest.fn();
  const stop = status.subscribe(listener);
  stop();
  status.watch(socket);
  socket.emit('connect_error', new Error('xhr poll error'));
  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(listener).not.toHaveBeenCalled();
});

it('falha ao conectar conta como queda (servidor fora do ar ao abrir o app)', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  status.watch(socket);
  socket.emit('connect_error', new Error('xhr poll error'));
  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(status.isLost()).toBe(true);
});

it('cada tentativa de reconexão que falha não reinicia a carência', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');
  jest.advanceTimersByTime(6_000);
  socket.emit('connect_error', new Error('xhr poll error'));
  jest.advanceTimersByTime(4_000);
  expect(status.isLost()).toBe(true);
});

it('volta antes da carência não vira queda, mas avisa a volta para a tela reler', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const listener = jest.fn();
  const back = jest.fn();
  status.subscribe(listener);
  status.onReconnect(back);
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');
  jest.advanceTimersByTime(2_000);
  socket.emit('connect');

  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(status.isLost()).toBe(false);
  expect(listener).not.toHaveBeenCalled();
  expect(back).toHaveBeenCalledTimes(1);
});

it('a primeira conexão não é volta: nada caiu antes dela', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const back = jest.fn();
  status.onReconnect(back);
  status.watch(socket);
  socket.emit('connect');
  expect(back).not.toHaveBeenCalled();
});

it.each(['io server disconnect', 'io client disconnect'])(
  'desconexão por "%s" não é queda: o servidor recusou a sessão ou o app fechou',
  (reason) => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    status.watch(socket);
    socket.emit('connect');
    socket.emit('disconnect', reason);
    jest.advanceTimersByTime(CONNECTION_GRACE_MS * 2);
    expect(status.isLost()).toBe(false);
  },
);

it('com vários sockets caídos, a volta só é avisada quando o último reconecta', () => {
  const status = createConnectionStatus();
  const notifications = fakeSocket();
  const chat = fakeSocket();
  const back = jest.fn();
  status.onReconnect(back);
  status.watch(notifications);
  status.watch(chat);
  for (const s of [notifications, chat]) {
    s.emit('connect');
    s.emit('disconnect', 'transport close');
  }
  jest.advanceTimersByTime(CONNECTION_GRACE_MS);

  notifications.emit('connect');
  expect(back).not.toHaveBeenCalled();
  expect(status.isLost()).toBe(true);

  chat.emit('connect');
  expect(back).toHaveBeenCalledTimes(1);
  expect(status.isLost()).toBe(false);
});

it('socket caído que sai do registro (a tela fechou) não deixa a queda presa nem avisa volta', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const back = jest.fn();
  status.onReconnect(back);
  const unwatch = status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');
  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(status.isLost()).toBe(true);

  unwatch();
  expect(status.isLost()).toBe(false);
  expect(back).not.toHaveBeenCalled();
});

it('ao sair do registro tira os três ouvintes do socket', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const unwatch = status.watch(socket);
  expect(socket.listeners('connect')).toBe(1);
  expect(socket.listeners('disconnect')).toBe(1);
  expect(socket.listeners('connect_error')).toBe(1);

  unwatch();
  expect(socket.listeners('connect')).toBe(0);
  expect(socket.listeners('disconnect')).toBe(0);
  expect(socket.listeners('connect_error')).toBe(0);
  // Chamar de novo não tem efeito.
  unwatch();
});

it('quem cancela o aviso de volta não é mais chamado', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  const back = jest.fn();
  const stop = status.onReconnect(back);
  stop();
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');
  socket.emit('connect');
  expect(back).not.toHaveBeenCalled();
});

// A carência conta pelo timer, não pelo relógio de parede: relógio do sistema
// ajustado para trás não pode esconder a queda.
it('a queda vira aviso depois da carência mesmo com o relógio do sistema voltando', () => {
  const status = createConnectionStatus();
  const socket = fakeSocket();
  status.watch(socket);
  socket.emit('connect');
  socket.emit('disconnect', 'transport close');
  jest.setSystemTime(Date.now() - 60 * 60_000);

  jest.advanceTimersByTime(CONNECTION_GRACE_MS);
  expect(status.isLost()).toBe(true);
});

it('volta pendente não se perde quando o último socket caído sai do registro', () => {
  const status = createConnectionStatus();
  const notifications = fakeSocket();
  const chat = fakeSocket();
  const back = jest.fn();
  status.onReconnect(back);
  status.watch(notifications);
  const unwatchChat = status.watch(chat);
  for (const s of [notifications, chat]) {
    s.emit('connect');
    s.emit('disconnect', 'transport close');
  }

  notifications.emit('connect');
  expect(back).not.toHaveBeenCalled();
  // A tela do chat fechou com o socket dela ainda caído.
  unwatchChat();
  expect(back).toHaveBeenCalledTimes(1);
});

it('com quedas sobrepostas o aviso não pisca: só sai quando nenhum socket está caído', () => {
  const status = createConnectionStatus();
  const a = fakeSocket();
  const b = fakeSocket();
  const listener = jest.fn();
  status.subscribe(listener);
  status.watch(a);
  status.watch(b);
  a.emit('connect');
  b.emit('connect');

  a.emit('disconnect', 'transport close');
  jest.advanceTimersByTime(6_000);
  b.emit('disconnect', 'transport close');
  jest.advanceTimersByTime(4_000);
  expect(status.isLost()).toBe(true);

  a.emit('connect');
  expect(status.isLost()).toBe(true);
  jest.advanceTimersByTime(6_000);
  expect(status.isLost()).toBe(true);

  b.emit('connect');
  expect(status.isLost()).toBe(false);
  expect(listener).toHaveBeenCalledTimes(2);
});

describe('segundo plano', () => {
  // Com o app parado o sistema suspende os timers, que disparam todos juntos
  // na volta. Sem a pausa, o socket derrubado pelo sistema viraria aviso no
  // instante da volta, antes de ter chance de reconectar.
  it('com o app pausado a carência não corre, e na volta conta do zero', () => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    status.watch(socket);
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');
    jest.advanceTimersByTime(8_000);

    status.pause();
    jest.advanceTimersByTime(60_000);
    expect(status.isLost()).toBe(false);

    status.resume();
    jest.advanceTimersByTime(CONNECTION_GRACE_MS - 1);
    expect(status.isLost()).toBe(false);
    jest.advanceTimersByTime(1);
    expect(status.isLost()).toBe(true);
  });

  it('queda durante a pausa só começa a contar na volta', () => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    status.watch(socket);
    socket.emit('connect');

    status.pause();
    socket.emit('disconnect', 'transport close');
    jest.advanceTimersByTime(60_000);
    expect(status.isLost()).toBe(false);

    status.resume();
    jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    expect(status.isLost()).toBe(true);
  });

  it('socket que reconecta logo depois da volta não vira aviso, e a tela relê', () => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    const listener = jest.fn();
    const back = jest.fn();
    status.subscribe(listener);
    status.onReconnect(back);
    status.watch(socket);
    socket.emit('connect');
    status.pause();
    socket.emit('disconnect', 'transport close');
    jest.advanceTimersByTime(60_000);

    status.resume();
    jest.advanceTimersByTime(3_000);
    socket.emit('connect');
    jest.advanceTimersByTime(CONNECTION_GRACE_MS);

    expect(listener).not.toHaveBeenCalled();
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('aviso que já estava na tela continua enquanto o socket segue caído', () => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    const listener = jest.fn();
    status.subscribe(listener);
    status.watch(socket);
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');
    jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    expect(status.isLost()).toBe(true);

    status.pause();
    status.resume();
    expect(status.isLost()).toBe(true);
    jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    expect(status.isLost()).toBe(true);
    expect(listener).toHaveBeenCalledTimes(1);

    socket.emit('connect');
    expect(status.isLost()).toBe(false);
  });

  it('pausar ou voltar duas vezes seguidas não muda nada', () => {
    const status = createConnectionStatus();
    const socket = fakeSocket();
    status.watch(socket);
    socket.emit('connect');
    socket.emit('disconnect', 'transport close');

    status.resume();
    status.pause();
    status.pause();
    jest.advanceTimersByTime(60_000);
    expect(status.isLost()).toBe(false);

    status.resume();
    status.resume();
    jest.advanceTimersByTime(CONNECTION_GRACE_MS);
    expect(status.isLost()).toBe(true);
  });
});
