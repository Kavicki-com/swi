export function requireJwtSecret(): string {
  const secret = process.env.JWT_SECRET
  if (!secret) throw new Error('JWT_SECRET não definido — configure swi-backend/.env (sem fallback; ver .env.example)')
  return secret
}
