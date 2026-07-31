import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { EditMessageDto, SendMessageDto } from './dto'

const errs = async (body: string) =>
  (await validate(plainToInstance(SendMessageDto, { body }))).length

describe('SendMessageDto', () => {
  it('aceita body <= 4000', async () => { expect(await errs('a'.repeat(4000))).toBe(0) })
  it('rejeita body > 4000', async () => { expect(await errs('a'.repeat(4001))).toBeGreaterThan(0) })
})

// QA Web #4: editar mensagem. Diferente do envio, aqui o body é OBRIGATÓRIO.
// Enviar só imagem existe; editar para vazio não, porque seria exclusão
// disfarçada, sem lápide e sem trilha.
describe('EditMessageDto', () => {
  const editErrs = async (body: unknown) =>
    (await validate(plainToInstance(EditMessageDto, { body }))).length

  it('aceita texto normal', async () => { expect(await editErrs('texto corrigido')).toBe(0) })
  it('rejeita body ausente', async () => { expect(await editErrs(undefined)).toBeGreaterThan(0) })
  it('rejeita body vazio', async () => { expect(await editErrs('')).toBeGreaterThan(0) })
  it('rejeita body só de espaço', async () => { expect(await editErrs('   ')).toBeGreaterThan(0) })
  it('rejeita body > 4000, igual ao envio', async () => {
    expect(await editErrs('a'.repeat(4001))).toBeGreaterThan(0)
  })
})
