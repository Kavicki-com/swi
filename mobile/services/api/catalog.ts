import { apiRequest } from './http';

export interface ProfileCatalog {
  jobTitles: string[];
  sectors: string[];
  duties: string[];
  /** Quem pode ser "Gerente responsável" — mesma régua de staff que decide
   *  quem revisa relatório (backend common/staff + role ADMIN). O combo abria
   *  vazio porque o catálogo não devolvia esta lista (QA 2026-07-27). */
  managers: string[];
}

// Vocabulário REAL da org (GET /profile/catalog — DISTINCT de
// jobTitle/sector/duty, org-scoped). Mesmas listas que o painel usa: os
// Comboboxes de Dados pessoais renderizavam options={[]} e o valor salvo nem
// se exibia (QA 2026-07-26).
export function fetchProfileCatalog(): Promise<ProfileCatalog> {
  return apiRequest<ProfileCatalog>('/profile/catalog', { auth: true });
}
