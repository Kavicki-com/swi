import { BadRequestException } from '@nestjs/common'
import { ChatController } from './chat.controller'
import type { ChatService } from './chat.service'
import type { JwtUser } from '../auth/current-user.decorator'

// A regra que o controller carrega sozinho é a de mensagem vazia: corpo em
// branco SEM imagem é 400, mas corpo em branco COM imagem é legítimo (mandar só
// foto). O resto é encaminhamento com o autor vindo do token.

const service = () =>
  ({
    listConversations: jest.fn().mockResolvedValue([]),
    listDirectory: jest.fn().mockResolvedValue([]),
    listMessages: jest.fn().mockResolvedValue([]),
    sendMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    editMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    deleteMessage: jest.fn().mockResolvedValue({ id: 'm1' }),
    markRead: jest.fn().mockResolvedValue(undefined),
    reportMessage: jest.fn().mockResolvedValue(undefined),
  }) as unknown as jest.Mocked<ChatService>

const user = { userId: 'u1', companyId: 'empresa-1', role: 'WORKER' } as unknown as JwtUser

describe('ChatController', () => {
  it('listagens usam o usuário do token', async () => {
    const s = service()
    const c = new ChatController(s)

    await c.listConversations('u1')
    await c.listDirectory(user)
    await c.listMessages('u1', 'conv-1')

    expect(s.listConversations).toHaveBeenCalledWith('u1')
    expect(s.listDirectory).toHaveBeenCalledWith('u1')
    expect(s.listMessages).toHaveBeenCalledWith('u1', 'conv-1')
  })

  it.each([
    ['corpo ausente', {}],
    ['corpo vazio', { body: '' }],
    ['corpo só com espaços', { body: '   ' }],
  ])('recusa mensagem sem conteúdo: %s', async (_caso, dto) => {
    const s = service()
    expect(() => new ChatController(s).send('u1', 'conv-1', dto as never)).toThrow(BadRequestException)
    expect(s.sendMessage).not.toHaveBeenCalled()
  })

  it('aceita mensagem sem texto quando tem imagem', async () => {
    const s = service()
    await new ChatController(s).send('u1', 'conv-1', { body: '  ', imageKey: 'chat/abc.jpg' })
    expect(s.sendMessage).toHaveBeenCalledWith('u1', 'conv-1', { body: '  ', imageKey: 'chat/abc.jpg' })
  })

  it('editar, excluir, marcar lida e denunciar carregam autor, conversa e mensagem', async () => {
    const s = service()
    const c = new ChatController(s)

    await c.edit('u1', 'conv-1', 'm1', { body: 'novo' })
    await c.remove('u1', 'conv-1', 'm1')
    await c.markRead('u1', 'conv-1')
    await c.report('u1', 'conv-1', 'm1', { reason: 'abuso' })

    expect(s.editMessage).toHaveBeenCalledWith('u1', 'conv-1', 'm1', { body: 'novo' })
    expect(s.deleteMessage).toHaveBeenCalledWith('u1', 'conv-1', 'm1')
    expect(s.markRead).toHaveBeenCalledWith('u1', 'conv-1')
    expect(s.reportMessage).toHaveBeenCalledWith('u1', 'conv-1', 'm1', { reason: 'abuso' })
  })
})
