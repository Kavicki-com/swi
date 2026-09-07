import * as SecureStore from 'expo-secure-store';
import {
  WATCH_ONBOARDING_KEY,
  markWatchOnboardingComplete,
  readWatchOnboarding,
} from './watchOnboarding';

// Dublê em memória do SecureStore, no mesmo formato usado por
// services/api/http.test.ts. O módulo é a única persistência do app.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    setItemAsync: jest.fn(async (k: string, v: string) => {
      store.set(k, v);
    }),
    getItemAsync: jest.fn(async (k: string) => store.get(k) ?? null),
    deleteItemAsync: jest.fn(async (k: string) => {
      store.delete(k);
    }),
  };
});

const COMPLETADO_EM = '2026-09-02T13:00:00.000Z';

beforeEach(async () => {
  jest.clearAllMocks();
  await SecureStore.deleteItemAsync(WATCH_ONBOARDING_KEY);
});

describe('watchOnboarding', () => {
  it('sem nada gravado, o primeiro uso ainda não passou', async () => {
    await expect(readWatchOnboarding()).resolves.toBeNull();
  });

  it('marcar como concluído guarda o instante e permite lê-lo de volta', async () => {
    await markWatchOnboardingComplete(COMPLETADO_EM);
    await expect(readWatchOnboarding()).resolves.toEqual({ completedAt: COMPLETADO_EM });
  });

  it('guarda apenas o instante: nada sobre autorização concedida ou negada', async () => {
    await markWatchOnboardingComplete(COMPLETADO_EM);
    const gravado = (SecureStore.setItemAsync as jest.Mock).mock.calls[0][1] as string;
    expect(Object.keys(JSON.parse(gravado))).toEqual(['completedAt']);
    expect(gravado).not.toMatch(/grant|denied|authorized|negad|permiss/i);
  });

  it('conteúdo corrompido é tratado como ausência, sem lançar', async () => {
    await SecureStore.setItemAsync(WATCH_ONBOARDING_KEY, '{nao é json');
    await expect(readWatchOnboarding()).resolves.toBeNull();
  });

  it('JSON válido sem completedAt utilizável é ausência', async () => {
    await SecureStore.setItemAsync(WATCH_ONBOARDING_KEY, JSON.stringify({ completedAt: 42 }));
    await expect(readWatchOnboarding()).resolves.toBeNull();
  });

  it('leitura que falha no aparelho não derruba o cadastro', async () => {
    (SecureStore.getItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('keychain indisponível'),
    );
    await expect(readWatchOnboarding()).resolves.toBeNull();
  });

  it('gravação que falha no aparelho não derruba o cadastro', async () => {
    (SecureStore.setItemAsync as jest.Mock).mockRejectedValueOnce(
      new Error('keychain indisponível'),
    );
    await expect(markWatchOnboardingComplete(COMPLETADO_EM)).resolves.toBeUndefined();
  });
});
