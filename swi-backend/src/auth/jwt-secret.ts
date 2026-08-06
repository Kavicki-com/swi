import { MIN_JWT_SECRET_LENGTH } from '../config/runtime-env'

export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET não definido. Configure swi-backend/.env (sem fallback; ver .env.example)')
  // Mesma exigência do contrato de ambiente (src/config/runtime-env.ts). Em dev
  // e teste um segredo curto é conveniente e inofensivo; em produção ele torna
  // o token forjável por força bruta.
  if (process.env.NODE_ENV === 'production' && secret.length < MIN_JWT_SECRET_LENGTH) {
    throw new Error(`JWT_SECRET precisa ter ao menos ${MIN_JWT_SECRET_LENGTH} caracteres em produção`)
  }
  return secret
}
