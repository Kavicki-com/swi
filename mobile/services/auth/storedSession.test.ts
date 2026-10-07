import * as SecureStore from 'expo-secure-store';
import type { User } from '../types';
import {
  OFFLINE_SESSION_MAX_MS,
  clearStoredSession,
  isFresh,
  isUser,
  readStoredSession,
  writeStoredSession,
} from './storedSession';

jest.mock('expo-secure-store', () => {
  const itens = new Map<string, string>();
  return {
    AFTER_FIRST_UNLOCK: 'afterFirstUnlock',
    __itens: itens,
    setItemAsync: jest.fn(async (k: string, v: string) => { itens.set(k, v); }),
    getItemAsync: jest.fn(async (k: string) => itens.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => { itens.delete(k); }),
  };
});

const store = SecureStore as unknown as {
  __itens: Map<string, string>;
  setItemAsync: jest.Mock;
  getItemAsync: jest.Mock;
  deleteItemAsync: jest.Mock;
};

const KEY = 'swi.auth.session';
const ana: User = { id: 'u1', email: 'ana@ex.com', name: 'Ana' };
const CONFIRMED = '2026-10-07T12:00:00.000Z';

beforeEach(() => {
  store.__itens.clear();
  jest.clearAllMocks();
});

describe('storedSession', () => {
  it('grava a sessão legível depois do primeiro desbloqueio e lê de volta', async () => {
    await writeStoredSession(ana, new Date(CONFIRMED));

    expect(store.setItemAsync).toHaveBeenCalledWith(KEY, expect.any(String), {
      keychainAccessible: 'afterFirstUnlock',
    });
    await expect(readStoredSession()).resolves.toEqual({ user: ana, confirmedAt: CONFIRMED });
  });

  it('grava com o padrão do sistema quando a acessibilidade é recusada', async () => {
    store.setItemAsync.mockRejectedValueOnce(new Error('keychain'));

    await writeStoredSession(ana, new Date(CONFIRMED));

    expect(store.setItemAsync).toHaveBeenLastCalledWith(KEY, expect.any(String));
    await expect(readStoredSession()).resolves.toEqual({ user: ana, confirmedAt: CONFIRMED });
  });

  it('guarda só id, e-mail e nome', async () => {
    const comMais = { ...ana, role: 'WORKER', bloodType: 'O+' } as unknown as User;

    await writeStoredSession(comMais, new Date(CONFIRMED));

    expect(JSON.parse(store.__itens.get(KEY)!)).toEqual({ v: 1, user: ana, confirmedAt: CONFIRMED });
  });

  it.each([
    ['JSON quebrado', '{'],
    ['versão desconhecida', JSON.stringify({ v: 2, user: ana, confirmedAt: CONFIRMED })],
    ['sem id', JSON.stringify({ v: 1, user: { email: 'a', name: 'A' }, confirmedAt: CONFIRMED })],
    ['nome que não é texto', JSON.stringify({ v: 1, user: { ...ana, name: 3 }, confirmedAt: CONFIRMED })],
    ['sem a hora da confirmação', JSON.stringify({ v: 1, user: ana })],
    ['nulo', 'null'],
  ])('lê null com conteúdo que não é uma sessão (%s)', async (_caso, conteudo) => {
    store.__itens.set(KEY, conteudo);
    await expect(readStoredSession()).resolves.toBeNull();
  });

  it('lê null sem item guardado', async () => {
    await expect(readStoredSession()).resolves.toBeNull();
  });

  it('lê null quando o SecureStore falha', async () => {
    store.getItemAsync.mockRejectedValueOnce(new Error('bloqueado'));
    await expect(readStoredSession()).resolves.toBeNull();
  });

  it('apaga a sessão guardada', async () => {
    await writeStoredSession(ana, new Date(CONFIRMED));

    await clearStoredSession();

    expect(store.deleteItemAsync).toHaveBeenCalledWith(KEY);
    await expect(readStoredSession()).resolves.toBeNull();
  });
});

describe('isFresh', () => {
  const stored = { user: ana, confirmedAt: CONFIRMED };
  const at = Date.parse(CONFIRMED);

  it('vale até 72 h depois da última confirmação', () => {
    expect(isFresh(stored, new Date(at + OFFLINE_SESSION_MAX_MS - 1))).toBe(true);
  });

  it('vence ao completar 72 h', () => {
    expect(OFFLINE_SESSION_MAX_MS).toBe(72 * 60 * 60 * 1000);
    expect(isFresh(stored, new Date(at + OFFLINE_SESSION_MAX_MS))).toBe(false);
  });

  // Relógio adiantado na gravação e acertado depois: a confirmação fica "no
  // futuro" e, sem limite, a cópia valeria para sempre.
  it('não vale com a confirmação no futuro além de uma folga pequena', () => {
    expect(isFresh(stored, new Date(at - 60 * 1000))).toBe(true);
    expect(isFresh(stored, new Date(at - 60 * 60 * 1000))).toBe(false);
  });

  it('não vale com a hora ilegível', () => {
    expect(isFresh({ user: ana, confirmedAt: 'ontem' }, new Date(at))).toBe(false);
  });
});

describe('isUser', () => {
  it('aceita id, e-mail e nome em texto', () => {
    expect(isUser(ana)).toBe(true);
  });

  it.each([
    ['nulo', null],
    ['corpo vazio de um portal de rede', {}],
    ['texto', '<html>'],
    ['id vazio', { ...ana, id: '' }],
    ['e-mail ausente', { id: 'u1', name: 'Ana' }],
  ])('recusa o que não é usuário (%s)', (_caso, valor) => {
    expect(isUser(valor)).toBe(false);
  });
});
