import * as SecureStore from 'expo-secure-store';

// O "Entendi" da lista de prontidão no dashboard. Fica só neste aparelho, por
// usuário, e só esconde a lista quando faltam apenas passos opcionais. Volta a
// "não tocado" sempre que um passo obrigatório reaparece (useReadiness.ts).
//
// Vive no SecureStore porque é a única persistência do app (ver
// watchOnboarding.ts). Não é segredo; é só onde o app guarda coisas.

const PREFIXO = 'swi.readiness.ack.v1.';
const TOCADO = '1';

// O SecureStore só aceita letras, números, ".", "-" e "_" na chave.
const chaveDe = (userId: string) => `${PREFIXO}${userId.replace(/[^A-Za-z0-9._-]/g, '_')}`;

/** Ausência e falha de leitura dão no mesmo: não tocado, e a lista aparece. */
export async function readReadinessAck(userId: string): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(chaveDe(userId))) === TOCADO;
  } catch {
    return false;
  }
}

export async function saveReadinessAck(userId: string): Promise<void> {
  try {
    await SecureStore.setItemAsync(chaveDe(userId), TOCADO);
  } catch {
    // Perder o toque só mostra a lista de novo na próxima abertura.
  }
}

export async function clearReadinessAck(userId: string): Promise<void> {
  try {
    await SecureStore.deleteItemAsync(chaveDe(userId));
  } catch {
    // Sem apagar, o toque antigo seguiria valendo; a lista já está na tela
    // porque falta passo obrigatório, e a próxima volta tenta de novo.
  }
}
