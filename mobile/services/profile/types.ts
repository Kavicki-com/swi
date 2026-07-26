// Local mirror of the swi-backend Profile model. Siblings are isolated, so
// we do NOT import the backend Schema type; after deploy, `ampx generate
// graphql-client-code --out` can replace this with generated types (Phase 6).
export interface Profile {
  fullName?: string;
  phone?: string;
  cpf?: string;
  birthDate?: string;
  cep?: string;
  street?: string;
  number?: string;
  complement?: string;
  neighborhood?: string;
  city?: string;
  uf?: string;
  // Cadastro profissional (settings/dados pessoais) — livres no backend.
  sector?: string;
  jobTitle?: string;
  duty?: string;
  managerName?: string;
  // Saúde DIGITÁVEL (wizard step-3 + settings/dados de saúde). Nada aqui vem
  // da smartband: ou o usuário digitou, ou fica vazio — nunca mock (decisão
  // 2026-07-26). gender é CÓDIGO ('male'/'female'), a convenção do painel.
  gender?: string;
  bloodType?: string;
  allergies?: string;
  chronicConditions?: string;
  heightCm?: number;
  weightKg?: number;
  hasDisability?: boolean;
}

export interface ProfileBackend {
  get(): Promise<Profile | null>;
  save(patch: Profile): Promise<Profile>;
}
