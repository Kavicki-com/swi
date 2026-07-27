import type { Profile, ProfileBackend } from './types';
import { apiRequest, hasToken } from '../api/http';
import { stashPendingProfile } from './pendingProfile';

// birthDate no backend é date-only: enviado como 'YYYY-MM-DD', retornado como
// ISO datetime 'YYYY-MM-DDT00:00:00.000Z'. As telas usam 'DD/MM/YYYY'.
// Helpers puros e tolerantes a undefined (não quebram se birthDate ausente).
export function brToIso(br?: string): string | undefined {
  if (!br) return undefined;
  const [dd, mm, yyyy] = br.split('/');
  return `${yyyy}-${mm}-${dd}`;
}

export function isoToBr(iso?: string): string | undefined {
  if (!iso) return undefined;
  const [yyyy, mm, dd] = iso.slice(0, 10).split('-');
  return `${dd}/${mm}/${yyyy}`;
}

// Converte o profile do backend (birthDate ISO) para o shape das telas (BR).
function fromApi(profile: Profile): Profile {
  return { ...profile, birthDate: isoToBr(profile.birthDate) };
}

export const apiProfileBackend: ProfileBackend = {
  async get() {
    try {
      const profile = await apiRequest<Profile>('/profile/me', { auth: true });
      return fromApi(profile);
    } catch (e) {
      // 404 = ainda não existe profile → null. Qualquer outro status
      // (500/rede) é falha real e propaga — não vira "perfil vazio".
      if ((e as any).status === 404) return null;
      throw e;
    }
  },
  async save(patch) {
    // A chave só entra quando o patch a traz. Antes ela era montada SEMPRE
    // (`birthDate: brToIso(patch.birthDate)`), valendo `undefined` nos patches
    // que não a incluem — e o stash do wizard faz `{ ...prev, ...patch }`, então
    // esse `undefined` do passo 2 (endereço) sobrescrevia a data guardada no
    // passo 1, e o JSON.stringify apagava a chave de vez. A ficha chegava ao
    // painel sem data de nascimento e, por consequência, sem idade
    // (QA 2026-07-27, confirmado no banco: telefone, CPF e endereço inteiros,
    // birthDate vazio).
    //
    // Só a data se perdia porque só ela era reescrita incondicionalmente aqui.
    const body = {
      ...patch,
      ...(patch.birthDate !== undefined ? { birthDate: brToIso(patch.birthDate) } : {}),
    };
    // Sem sessão = wizard de onboarding pré-login (a conta ainda aguarda
    // aprovação do admin). Stash local em vez de PUT: sem isso o 401 alertava
    // "Não foi possível salvar" e o step-1 nem avançava (QA 2026-07-26).
    // O flush roda no primeiro login (apiAuthBackend.signIn).
    if (!(await hasToken())) {
      const merged = await stashPendingProfile(body as Record<string, unknown>);
      return fromApi(merged as Profile);
    }
    const profile = await apiRequest('/profile/me', { method: 'PUT', body, auth: true });
    return fromApi(profile);
  },
};
