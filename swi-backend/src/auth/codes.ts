import * as bcrypt from 'bcrypt'

// código de 6 dígitos legível no MailHog
export function generateCode(): string {
  let s = ''
  for (let i = 0; i < 6; i++) s += Math.floor(Math.random() * 10)
  return s
}
export const hash = (v: string) => bcrypt.hash(v, 10)
export const verifyHash = (v: string, h: string) => bcrypt.compare(v, h)
