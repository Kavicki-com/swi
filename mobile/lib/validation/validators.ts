// Pure form-field validators. Each returns { valid, error? } so callers can
// uniformly wire them into useField and the DS Input's descriptionVariant.
//
// The error strings are the canonical Portuguese copy used in form UI — keep
// them short enough to fit one line under the input.

import { isPasswordValid, validatePassword as checkPasswordRules } from '../validatePassword';

export interface ValidationResult {
  valid: boolean;
  error?: string;
}

const ok = (): ValidationResult => ({ valid: true });
const fail = (error: string): ValidationResult => ({ valid: false, error });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const BR_UFS = new Set([
  'AC', 'AL', 'AP', 'AM', 'BA', 'CE', 'DF', 'ES', 'GO', 'MA',
  'MT', 'MS', 'MG', 'PA', 'PB', 'PR', 'PE', 'PI', 'RJ', 'RN',
  'RS', 'RO', 'RR', 'SC', 'SP', 'SE', 'TO',
]);

const digitsOnly = (v: string): string => v.replace(/\D/g, '');

export function validateRequired(v: string, label = 'Campo'): ValidationResult {
  return v.trim().length > 0 ? ok() : fail(`${label} é obrigatório`);
}

export function validateEmail(v: string): ValidationResult {
  if (v.trim().length === 0) return fail('Email é obrigatório');
  if (!EMAIL_RE.test(v.trim())) return fail('Email inválido');
  return ok();
}

export function validateFullName(v: string): ValidationResult {
  const trimmed = v.trim();
  if (trimmed.length === 0) return fail('Nome é obrigatório');
  const parts = trimmed.split(/\s+/);
  if (parts.length < 2 || parts.some((p) => p.length < 2)) {
    return fail('Informe seu nome completo');
  }
  return ok();
}

export function validatePhone(v: string): ValidationResult {
  const d = digitsOnly(v);
  if (d.length === 0) return fail('Telefone é obrigatório');
  if (d.length !== 10 && d.length !== 11) return fail('Telefone inválido');
  const ddd = Number(d.slice(0, 2));
  if (ddd < 11 || ddd > 99) return fail('DDD inválido');
  return ok();
}

// CPF: 11 dígitos, rejeita todos iguais, dígitos verificadores corretos.
export function validateCPF(v: string): ValidationResult {
  const d = digitsOnly(v);
  if (d.length === 0) return fail('CPF é obrigatório');
  if (d.length !== 11) return fail('CPF deve ter 11 dígitos');
  if (/^(\d)\1{10}$/.test(d)) return fail('CPF inválido');

  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * (10 - i);
  let check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(d[9])) return fail('CPF inválido');

  sum = 0;
  for (let i = 0; i < 10; i++) sum += Number(d[i]) * (11 - i);
  check = (sum * 10) % 11;
  if (check === 10) check = 0;
  if (check !== Number(d[10])) return fail('CPF inválido');

  return ok();
}

// CEP: 8 dígitos. A existência real é validada via cep-promise no useCepLookup.
export function validateCEP(v: string): ValidationResult {
  const d = digitsOnly(v);
  if (d.length === 0) return fail('CEP é obrigatório');
  if (d.length !== 8) return fail('CEP deve ter 8 dígitos');
  return ok();
}

export function validateUF(v: string): ValidationResult {
  const u = v.trim().toUpperCase();
  if (u.length === 0) return fail('UF é obrigatória');
  if (u.length !== 2) return fail('UF deve ter 2 letras');
  if (!BR_UFS.has(u)) return fail('UF inválida');
  return ok();
}

// Data: DD/MM/AAAA, calendário válido, ano entre 1900 e ano atual.
export function validateBirthDate(v: string): ValidationResult {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return fail('Data inválida (dd/mm/aaaa)');
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const currentYear = new Date().getFullYear();
  if (yyyy < 1900 || yyyy > currentYear) return fail('Ano inválido');
  if (mm < 1 || mm > 12) return fail('Mês inválido');
  const isLeap = (yyyy % 4 === 0 && yyyy % 100 !== 0) || yyyy % 400 === 0;
  const daysIn = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dd < 1 || dd > daysIn[mm - 1]) return fail('Dia inválido');
  return ok();
}

// Validade de exame clínico. Separado do nascimento porque a regra é o
// INVERSO: nascimento não pode estar no futuro, validade quase sempre está
// (as datas do Figma são 2027, 2029…). Aceita passado — exame vencido é um
// fato, não erro de digitação — e barra ano absurdo.
export function validateExamDate(v: string): ValidationResult {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(v.trim());
  if (!m) return fail('Data inválida (dd/mm/aaaa)');
  const dd = Number(m[1]);
  const mm = Number(m[2]);
  const yyyy = Number(m[3]);
  const currentYear = new Date().getFullYear();
  if (yyyy < currentYear - 50 || yyyy > currentYear + 50) return fail('Ano inválido');
  if (mm < 1 || mm > 12) return fail('Mês inválido');
  const isLeap = (yyyy % 4 === 0 && yyyy % 100 !== 0) || yyyy % 400 === 0;
  const daysIn = [31, isLeap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (dd < 1 || dd > daysIn[mm - 1]) return fail('Dia inválido');
  return ok();
}

// Senha: regras do projeto (validatePassword.ts). Adapta pro shape comum.
export function validatePasswordField(v: string): ValidationResult {
  if (v.length === 0) return fail('Senha é obrigatória');
  if (!isPasswordValid(v)) {
    const checks = checkPasswordRules(v);
    if (!checks.length) return fail('Mínimo 8 caracteres');
    if (!checks.lettersAndNumbers) return fail('Use letras e números');
    if (!checks.uppercase) return fail('Use ao menos 1 maiúscula');
    if (!checks.symbol) return fail('Use ao menos 1 símbolo (@#$%^)');
  }
  return ok();
}

export function validatePasswordMatch(pw: string, confirm: string): ValidationResult {
  if (confirm.length === 0) return fail('Confirme a senha');
  if (pw !== confirm) return fail('As senhas não coincidem');
  return ok();
}
