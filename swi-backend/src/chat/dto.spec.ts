import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { SendMessageDto } from './dto'

const errs = async (body: string) =>
  (await validate(plainToInstance(SendMessageDto, { body }))).length

describe('SendMessageDto', () => {
  it('aceita body <= 4000', async () => { expect(await errs('a'.repeat(4000))).toBe(0) })
  it('rejeita body > 4000', async () => { expect(await errs('a'.repeat(4001))).toBeGreaterThan(0) })
})
