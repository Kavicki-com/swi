import * as SecureStore from 'expo-secure-store';

// Marca de que o primeiro uso do Apple Watch já passou, para o cadastro não
// repetir a tela. É tudo que fica gravado.
//
// ADR-0004: o app NUNCA persiste se a autorização do HealthKit foi concedida ou
// negada. O iOS não expõe esse fato para leitura, e guardar a intenção do
// funcionário registraria como verdade algo que pode ser falso. Quem toca
// "Configurar depois" e quem nega na folha do sistema gravam exatamente isto.
//
// Vive no SecureStore porque é a única persistência do app (ver
// services/api/http.ts). Não é segredo; é só onde o app guarda coisas.

export const WATCH_ONBOARDING_KEY = 'swi.telemetry.onboarding.v1';

export interface WatchOnboardingRecord {
  /** ISO-8601 do instante em que o primeiro uso terminou. */
  readonly completedAt: string;
}

/**
 * Ausência e defeito são a mesma coisa para quem chama: os dois significam
 * "mostre o primeiro uso". Um keychain indisponível não pode derrubar o
 * cadastro, então nada aqui propaga erro.
 */
export async function readWatchOnboarding(): Promise<WatchOnboardingRecord | null> {
  let bruto: string | null;
  try {
    bruto = await SecureStore.getItemAsync(WATCH_ONBOARDING_KEY);
  } catch {
    return null;
  }
  if (!bruto) return null;

  try {
    const parsed: unknown = JSON.parse(bruto);
    if (typeof parsed !== 'object' || parsed === null) return null;
    const { completedAt } = parsed as { completedAt?: unknown };
    if (typeof completedAt !== 'string' || completedAt === '') return null;
    return { completedAt };
  } catch {
    return null;
  }
}

/** Recebe o instante por parâmetro, para o teste não depender do relógio. */
export async function markWatchOnboardingComplete(completedAt: string): Promise<void> {
  const registro: WatchOnboardingRecord = { completedAt };
  try {
    await SecureStore.setItemAsync(WATCH_ONBOARDING_KEY, JSON.stringify(registro));
  } catch {
    // Perder a marca só repete uma tela; travar o cadastro é pior.
  }
}
