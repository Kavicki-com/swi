import { apiRequest } from './http';

export interface CompanyOption {
  id: string;
  name: string;
}

// Catálogo público de empresas (GET /companies — só id + nome, pré-login).
// Alimenta o seletor da tela de cadastro: o worker escolhe a empresa e o
// signup grava o vínculo, sem o qual ele fica invisível na fila de aprovação
// org-scoped do painel (QA 2026-07-26).
export function listCompanies(): Promise<CompanyOption[]> {
  return apiRequest<CompanyOption[]>('/companies');
}
