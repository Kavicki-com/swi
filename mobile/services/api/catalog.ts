import { apiRequest } from './http';

export interface ProfileCatalog {
  jobTitles: string[];
  sectors: string[];
  duties: string[];
  /** Quem pode ser "Gerente responsável" — mesma régua de staff que decide
   *  quem revisa relatório (backend common/staff + role ADMIN). */
  managers: string[];
}

// Vocabulário da organização, vindo de GET /profile/catalog: valores distintos
// de jobTitle, sector e duty, com escopo por empresa. São as mesmas listas que
// o painel usa, e alimentam as opções dos campos de dados pessoais.
export function fetchProfileCatalog(): Promise<ProfileCatalog> {
  return apiRequest<ProfileCatalog>('/profile/catalog', { auth: true });
}
