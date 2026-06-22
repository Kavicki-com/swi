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
}

export interface ProfileBackend {
  get(): Promise<Profile | null>;
  save(patch: Profile): Promise<Profile>;
}
