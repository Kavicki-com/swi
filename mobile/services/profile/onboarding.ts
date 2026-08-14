import type { Profile } from './types';

// Decide, no login, se o worker ainda precisa passar pelo wizard de
// complimentary-data. A conta nasce primeiro, o admin aprova, e SÓ ENTÃO o
// perfil é preenchido, autenticado com o token do próprio worker.
//
// Um marcador obrigatório por passo: CPF (passo 1), CEP (passo 2), tipo
// sanguíneo (passo 3). Todos são exigidos pelo `canSubmit` do seu passo, então
// a ausência de qualquer um significa wizard abandonado no meio — o próximo
// login volta pro passo 1, e o que já foi salvo continua no servidor.
export function onboardingPendente(profile: Profile | null): boolean {
  if (!profile) return true;
  return !profile.cpf || !profile.cep || !profile.bloodType;
}
