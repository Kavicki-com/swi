import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { EditMessageDto, ReportMessageDto, SendMessageDto } from './dto'

const errs = async (body: string) =>
  (await validate(plainToInstance(SendMessageDto, { body }))).length

describe('SendMessageDto', () => {
  it('aceita body <= 4000', async () => { expect(await errs('a'.repeat(4000))).toBe(0) })
  it('rejeita body > 4000', async () => { expect(await errs('a'.repeat(4001))).toBeGreaterThan(0) })
})

// Editar mensagem. Diferente do envio, aqui o body é OBRIGATÓRIO.
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

// Denunciar mensagem. Motivo obrigatório (a lista fica no painel, o backend
// valida formato) e detalhe opcional limitado a cerca de 240 caracteres.
describe('ReportMessageDto', () => {
  const reportErrs = async (payload: Record<string, unknown>) =>
    (await validate(plainToInstance(ReportMessageDto, payload))).length

  it('aceita motivo com detalhe no limite', async () => {
    expect(await reportErrs({ reason: 'Assédio', text: 'a'.repeat(240) })).toBe(0)
  })
  it('aceita motivo sem detalhe', async () => {
    expect(await reportErrs({ reason: 'Spam' })).toBe(0)
  })
  it('rejeita motivo ausente ou só de espaço', async () => {
    expect(await reportErrs({})).toBeGreaterThan(0)
    expect(await reportErrs({ reason: '   ' })).toBeGreaterThan(0)
  })
  it('rejeita detalhe > 240', async () => {
    expect(await reportErrs({ reason: 'Spam', text: 'a'.repeat(241) })).toBeGreaterThan(0)
  })
  it('rejeita motivo > 80', async () => {
    expect(await reportErrs({ reason: 'a'.repeat(81) })).toBeGreaterThan(0)
  })
})
