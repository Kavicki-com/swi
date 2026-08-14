import { SupportService } from './support.service'

// O modal "Solicitação de suporte" (login e settings) precisa PERSISTIR o
// pedido em SupportRequest, senão ele fecha sem chamada e sem registro. O
// vínculo é opcional: userId do JWT quando logado, email digitado quando não.
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
