import { SupportService } from './support.service'

// QA F (2026-07-24): o modal "Solicitação de suporte" (login e settings)
// fechava descartando o pedido — nenhuma chamada, nenhum registro. Agora o
// pedido é PERSISTIDO (SupportRequest) com vínculo opcional (userId do JWT
// quando logado; email digitado quando não).
const prisma = () => ({ supportRequest: { create: jest.fn().mockResolvedValue({ id: 'sr1' }) } }) as any

describe('SupportService', () => {
  it('persiste o pedido com reason/title/message e vínculos opcionais', async () => {
    const db = prisma()
    const out = await new SupportService(db).create(
      { reason: 'Problema técnico', title: 'Título', message: 'Mensagem', email: 'a@b.c' },
      'u1',
    )
    expect(db.supportRequest.create).toHaveBeenCalledWith({
      data: {
        reason: 'Problema técnico',
        title: 'Título',
        message: 'Mensagem',
        email: 'a@b.c',
        userId: 'u1',
      },
    })
    expect(out).toEqual({ id: 'sr1' })
  })

  it('anônimo (tela de login): sem userId e sem email ainda persiste', async () => {
    const db = prisma()
    await new SupportService(db).create(
      { reason: 'Outros', title: 'T', message: 'M' },
      null,
    )
    expect(db.supportRequest.create.mock.calls[0][0].data).toEqual({
      reason: 'Outros',
      title: 'T',
      message: 'M',
      email: null,
      userId: null,
    })
  })
})
