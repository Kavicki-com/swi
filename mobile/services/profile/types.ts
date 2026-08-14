// Local mirror of the swi-backend Profile model. Siblings are isolated, so
// we do NOT import the backend types: this file is the REST contract boundary
// and has to be checked by hand whenever that contract changes.
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
  // Foto de perfil. `avatarKey` é o que se ESCREVE, a key devolvida pelo
  // presign no namespace avatars/. `avatarUrl` é o que se LÊ, a URL assinada
  // que o GET /profile/me devolve. Ignorar essa URL faz a tela renderizar um
  // PNG de estoque como se fosse a cara do usuário.
  avatarKey?: string;
  avatarUrl?: string;
  // Saúde DIGITÁVEL (wizard step-3 + settings/dados de saúde). Nada aqui vem
  // da smartband: ou o usuário digitou, ou fica vazio, nunca simulado.
  // gender é CÓDIGO ('male'/'female'), a convenção do painel.
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
