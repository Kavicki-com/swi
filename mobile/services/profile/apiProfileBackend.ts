import type { Profile, ProfileBackend } from './types';
import { apiRequest } from '../api/http';

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
    // A chave só entra quando o patch a traz. Montá-la sempre, como
    // `birthDate: brToIso(patch.birthDate)`, a faria valer `undefined` nos
    // patches que não a incluem. O stash do wizard faz `{ ...prev, ...patch }`,
    // então esse `undefined` do passo de endereço sobrescreveria a data
    // guardada no passo anterior, e o JSON.stringify apagaria a chave de vez.
    // A ficha chegaria ao painel sem data de nascimento e, por consequência,
    // sem idade.
    const body = {
      ...patch,
      ...(patch.birthDate !== undefined ? { birthDate: brToIso(patch.birthDate) } : {}),
    };
    // Sempre PUT autenticado. Todo save de perfil roda com sessão, porque o
    // wizard de complimentary-data é pós-login. Não existe stash local
    // pré-conta, e é isso que impede um token alheio esquecido de receber o
    // perfil de outra pessoa.
    const profile = await apiRequest('/profile/me', { method: 'PUT', body, auth: true });
    return fromApi(profile);
  },
};
