// Client do /profile/me: GET pré-preenche o form (404 = perfil ainda não
// preenchido, estado válido); PUT persiste. O backend devolve as keys cruas
// (o form mescla exames novos sobre elas) + URLs de view presignadas.
import type { ServiceResponse } from '@/services/types'
import { ApiError, apiFetch } from './http'

export type ProfileDto = {
  id: string
  userId: string
  fullName: string | null
  phone: string | null
  cpf: string | null
  birthDate: string | null
  cep: string | null
  street: string | null
  number: string | null
  complement: string | null
  neighborhood: string | null
  city: string | null
  uf: string | null
  sector: string | null
  jobTitle: string | null
  duty: string | null
  managerName: string | null
  gender: string | null
  bloodType: string | null
  allergies: string | null
  chronicConditions: string | null
  avatarKey: string | null
  avatarUrl: string | null
  examKeys: string[]
  examUrls: string[]
}

// Campos que o PUT aceita (espelha o UpdateProfileDto do backend — id/userId e
// as URLs presignadas são derivados, não entram no patch).
export type ProfilePatch = Partial<Omit<ProfileDto, 'id' | 'userId' | 'avatarUrl' | 'examUrls'>>

// GET /profile/catalog — DISTINCT org-scoped, ordenado pt-BR, sem vazios.
export type ProfileCatalog = {
  jobTitles: string[]
  sectors: string[]
  duties: string[]
}

export const profileApi = {
  me: async (): Promise<ServiceResponse<ProfileDto | null>> => {
    try {
      const p = await apiFetch<ProfileDto>('/profile/me')
      return { data: p, error: null }
    } catch (e) {
      // 404 = perfil ainda não preenchido — o form abre vazio, sem erro.
      if (e instanceof ApiError && e.status === 404) return { data: null, error: null }
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao carregar o perfil' },
      }
    }
  },

  // Vocabulário REAL da org (DISTINCT de jobTitle/sector/duty do backend).
  // Alimenta os Comboboxes do settings e o setor do form de tarefas, para as
  // telas não caírem em listas fixas divergentes entre si.
  catalog: async (): Promise<ServiceResponse<ProfileCatalog>> => {
    try {
      const c = await apiFetch<ProfileCatalog>('/profile/catalog')
      return { data: c, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao carregar o catálogo' },
      }
    }
  },

  update: async (patch: ProfilePatch): Promise<ServiceResponse<ProfileDto>> => {
    try {
      const p = await apiFetch<ProfileDto>('/profile/me', {
        method: 'PUT',
        body: JSON.stringify(patch),
      })
      return { data: p, error: null }
    } catch (e) {
      return {
        data: null,
        error: { message: e instanceof Error ? e.message : 'Falha ao salvar o perfil' },
      }
    }
  },
}
