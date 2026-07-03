import * as bcrypt from 'bcrypt'
import { randomInt } from 'node:crypto'

export const BCRYPT_COST = 12

// código de 6 dígitos legível no MailHog — CSPRNG (crypto.randomInt), NÃO Math.random previsível.
export function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0')
}

export const hash = (v: string) => bcrypt.hash(v, BCRYPT_COST)
export const verifyHash = (v: string, h: string) => bcrypt.compare(v, h)

// Hash bcrypt fixo (cost 12), computado 1× no load. O login compara a senha contra
// ele quando o e-mail NÃO existe, pra esse caminho custar ~o mesmo que "senha errada"
// (fecha o timing-oracle de enumeração). O valor em si nunca precisa bater.
export const DUMMY_HASH = bcrypt.hashSync('swi-timing-guard', BCRYPT_COST)
