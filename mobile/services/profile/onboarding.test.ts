import { onboardingPendente } from './onboarding';

// Conta primeiro, aprovação do admin, e o wizard de perfil roda DEPOIS do
// primeiro login. Este helper é o desvio do login: pendente → step-1,
// completo → dashboard.
const COMPLETO = {
  fullName: 'Fulana Teste',
  cpf: '529.982.247-25',
  cep: '27200-000',
  bloodType: 'O+',
};

describe('onboardingPendente', () => {
  it('sem perfil nenhum (primeiro login) → pendente', () => {
    expect(onboardingPendente(null)).toBe(true);
  });

  it('perfil com os marcadores dos 3 passos → completo', () => {
    expect(onboardingPendente(COMPLETO)).toBe(false);
  });

  // Abandono no meio: cada marcador é obrigatório no seu passo, então a
  // ausência denuncia exatamente "parou antes daquele passo terminar".
  it.each([
    ['cpf', 'passo 1'],
    ['cep', 'passo 2'],
    ['bloodType', 'passo 3'],
  ])('sem %s (%s incompleto) → pendente', (campo) => {
    expect(onboardingPendente({ ...COMPLETO, [campo]: undefined })).toBe(true);
  });

  // Só o nome vem do cadastro da conta, não conta como wizard feito.
  it('perfil só com fullName (veio do signup) → pendente', () => {
    expect(onboardingPendente({ fullName: 'Fulana Teste' })).toBe(true);
  });
});
