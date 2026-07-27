import * as SecureStore from 'expo-secure-store';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';
import { clearPendingAvatar, readPendingAvatar } from './pendingAvatar';

// O wizard de onboarding (complimentary-data) roda ANTES do primeiro login:
// no fluxo api o cadastro só destrava depois que o admin aprova no painel —
// o que pode levar dias. Sem este stash, tudo que o usuário digitou nos 3
// steps era descartado (QA 2026-07-26: o step-1 nem avançava — o PUT sem
// token dava 401 e o Alert bloqueava o fluxo).
//
// O patch fica no SecureStore (mesmo cofre do token; é PII) JÁ no formato da
// API (birthDate ISO — a conversão acontece antes do stash, no
// apiProfileBackend.save). Steps sucessivos fazem merge raso. O flush roda
// após cada login api: PUT /profile/me, limpa no sucesso, mantém na falha
// (best-effort — o login NUNCA falha por causa do flush).
const PENDING_KEY = 'swi.profile.pending';

export async function stashPendingProfile(
  patch: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const raw = await SecureStore.getItemAsync(PENDING_KEY);
  const prev = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
  // undefined não sobrevive ao JSON.stringify — o merge nunca apaga um campo
  // stashado por um step anterior.
  const merged = { ...prev, ...patch };
  await SecureStore.setItemAsync(PENDING_KEY, JSON.stringify(merged));
  return merged;
}

export async function readPendingProfile(): Promise<Record<string, unknown> | null> {
  const raw = await SecureStore.getItemAsync(PENDING_KEY);
  return raw ? (JSON.parse(raw) as Record<string, unknown>) : null;
}

// Descarta o rascunho. Chamado quando o cadastro sobe COM o perfil embutido
// (o wizard agora roda antes de criar a conta) — sem isto o mesmo dado subiria
// de novo no primeiro login, semanas depois, sobrescrevendo edições feitas no
// settings nesse meio-tempo.
export async function clearPendingProfile(): Promise<void> {
  await SecureStore.deleteItemAsync(PENDING_KEY);
}

export async function flushPendingProfile(): Promise<void> {
  try {
    const [pending, avatarPath] = await Promise.all([
      readPendingProfile(),
      readPendingAvatar(),
    ]);
    if (!pending && !avatarPath) return;

    const body: Record<string, unknown> = { ...(pending ?? {}) };

    // A foto escolhida no passo 1 do cadastro só pode subir AGORA: naquele
    // momento a conta ainda não existia e o presign exige token. O arquivo
    // ficou copiado no armazenamento do app esperando este login.
    //
    // try próprio: se o upload falhar (rede, arquivo corrompido), os CAMPOS do
    // perfil sobem do mesmo jeito e a foto fica pro próximo login. Sem isso,
    // uma foto problemática travaria o cadastro inteiro em todo login, pra
    // sempre.
    let avatarEnviado = false;
    if (avatarPath) {
      try {
        body.avatarKey = await uploadImage(avatarPath, 'avatars');
        avatarEnviado = true;
      } catch {
        // Fica pendente; tenta de novo no próximo login.
      }
    }

    await apiRequest('/profile/me', { method: 'PUT', body, auth: true });
    if (pending) await SecureStore.deleteItemAsync(PENDING_KEY);
    if (avatarEnviado) await clearPendingAvatar();
  } catch {
    // Fica pro próximo login — flush é best-effort por contrato.
  }
}
