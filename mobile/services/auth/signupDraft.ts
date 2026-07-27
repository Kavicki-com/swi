import type { SignUpParams } from './types';

// Credenciais do cadastro em curso, entre a tela de cadastro e o fim do wizard.
//
// A conta passou a ser criada NO FIM do fluxo (não mais no início): o worker
// preenche dados pessoais, endereço e saúde, e só então o cadastro sobe — já
// completo — pra fila de aprovação do painel. Antes o admin recebia uma linha
// com nome e e-mail e aprovava às cegas, porque o wizard só rodava no modo
// mock (QA 2026-07-26).
//
// EM MEMÓRIA de propósito: contém a senha em claro. O perfil pode ir pro
// SecureStore (pendingProfile) porque precisa sobreviver ao fechamento do app;
// a senha não — se o worker abandonar no meio, ele recomeça o cadastro, que é
// o comportamento correto.
let draft: SignUpParams | null = null;

export const signupDraft = {
  set(params: SignUpParams): void {
    draft = params;
  },
  get(): SignUpParams | null {
    return draft;
  },
  clear(): void {
    draft = null;
  },
};
