import {
  conversationKey,
  chatPathTo,
  applyMessage,
  isRevision,
  markRead,
  unreadFor,
  resolveContact,
  sortByRecent,
  upsertMessage,
} from './chatReducers'
import type { Conversation, Message } from './types'

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'a#b',
  participants: ['a', 'b'],
  participantNames: ['A', 'B'],
  participantSubtitles: ['', ''],
  participantAvatars: ['', ''],
  lastMessageBody: '',
  lastMessageAt: null,
  unreadBy: {},
  ...over,
})
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'a#b',
  participants: ['a', 'b'],
  senderId: 'b',
  body: 'oi',
  imageUri: null,
  sentAt: '2026-07-23T10:00:00.000Z',
  ...over,
})

describe('conversationKey', () => {
  it('ordena e junta com #', () => {
    expect(conversationKey('b', 'a')).toBe('a#b')
    expect(conversationKey('a', 'b')).toBe('a#b')
  })
})

// QA Web #10: os ícones de chat das listas navegavam pra /chat sem destino, e o
// inbox fixava a conversa MAIS RECENTE (sempre a mesma pessoa). O caminho certo
// leva o id determinístico da conversa, com o '#' encodado (senão vira fragmento
// de URL).
describe('chatPathTo', () => {
  it('monta /chat/<key> com o # encodado', () => {
    expect(chatPathTo('b', 'a')).toBe('/chat/a%23b')
    expect(chatPathTo('u_seed_1', 'w9')).toBe('/chat/u_seed_1%23w9')
  })

  it('sem myId cai no inbox puro, nunca numa key quebrada', () => {
    expect(chatPathTo('', 'w9')).toBe('/chat')
  })
})
describe('applyMessage', () => {
  it('incrementa unread de todos menos o remetente e atualiza lastMessage', () => {
    const [c] = applyMessage([conv()], msg({ senderId: 'b', body: 'oi' }))
    expect(c!.unreadBy).toEqual({ a: 1 })
    expect(c!.lastMessageBody).toBe('oi')
    expect(c!.lastMessageAt).toBe('2026-07-23T10:00:00.000Z')
  })
  it('mensagem só-imagem usa "📷 Imagem" no lastMessage', () => {
    const [c] = applyMessage([conv()], msg({ body: '', imageUri: 'x' }))
    expect(c!.lastMessageBody).toBe('📷 Imagem')
  })
  it('re-ordena por recência (mais nova primeiro)', () => {
    const older = conv({ id: 'a#b', lastMessageAt: '2026-07-20T00:00:00.000Z' })
    const newer = conv({
      id: 'a#c',
      participants: ['a', 'c'],
      lastMessageAt: '2026-07-22T00:00:00.000Z',
    })
    const out = applyMessage(
      [older, newer],
      msg({ conversationId: 'a#b', sentAt: '2026-07-23T00:00:00.000Z' }),
    )
    expect(out[0]!.id).toBe('a#b')
  })
})
describe('resolveContact', () => {
  it('pega o participante que não é o myId', () => {
    const c = conv({ participantSubtitles: ['', 'Setor Leste'], participantAvatars: ['', 'b.png'] })
    const r = resolveContact(c, 'a')
    expect(r.workerId).toBe('b')
    expect(r.name).toBe('B')
    expect(r.subtitle).toBe('Setor Leste')
    expect(r.avatarUri).toBe('b.png')
  })
})
describe('markRead', () => {
  it('zera unread do myId e preserva o dos outros', () => {
    const [c] = markRead([conv({ unreadBy: { a: 3, b: 5 } })], 'a#b', 'a')
    expect(unreadFor(c!, 'a')).toBe(0)
    expect(unreadFor(c!, 'b')).toBe(5)
  })
})
describe('sortByRecent', () => {
  it('joga a conversa com lastMessageAt null pro fim', () => {
    const dated = conv({ id: 'a#b', lastMessageAt: '2026-07-22T00:00:00.000Z' })
    const none = conv({ id: 'a#c', lastMessageAt: null })
    const out = sortByRecent([none, dated])
    expect(out[0]!.id).toBe('a#b')
    expect(out[1]!.id).toBe('a#c')
  })
})

// QA Web #4: editar e excluir mensagem. O backend emite o MESMO evento
// 'message' com o estado atual, porque um evento novo faria cliente antigo
// ignorar a edição em silêncio. Isso obriga duas regras aqui.
describe('revisão de mensagem (editada ou excluída)', () => {
  it('mensagem nova entra no fim da lista', () => {
    const antes = [msg({ id: 'm1' })]
    expect(upsertMessage(antes, msg({ id: 'm2' })).map((m) => m.id)).toEqual(['m1', 'm2'])
  })

  it('mensagem com id conhecido SUBSTITUI no lugar, sem duplicar a bolha', () => {
    const antes = [msg({ id: 'm1', body: 'errado' }), msg({ id: 'm2', body: 'depois' })]
    const depois = upsertMessage(antes, msg({ id: 'm1', body: 'corrigido', editedAt: 'x' }))
    expect(depois.map((m) => m.id)).toEqual(['m1', 'm2']) // ordem preservada
    expect(depois[0]!.body).toBe('corrigido')
    expect(depois).toHaveLength(2)
  })

  it('isRevision distingue estreia de revisão', () => {
    expect(isRevision(msg())).toBe(false)
    expect(isRevision(msg({ editedAt: '2026-07-31T11:00:00.000Z' }))).toBe(true)
    expect(isRevision(msg({ deletedAt: '2026-07-31T11:00:00.000Z' }))).toBe(true)
  })

  it('revisão NÃO incrementa não lidas: o badge já contou quando a mensagem estreou', () => {
    const base = conv({ unreadBy: { a: 1 } })
    const [c] = applyMessage([base], msg({ senderId: 'b', editedAt: '2026-07-31T11:00:00.000Z' }))
    expect(c!.unreadBy).toEqual({ a: 1 })
  })

  it('revisão não mexe no preview nem na ordem da caixa de entrada', () => {
    // Editar uma mensagem ANTIGA não pode rebaixar a conversa na lista: quem
    // manda na ordem é a última mensagem, e ela não mudou.
    const base = conv({
      lastMessageBody: 'a mais recente',
      lastMessageAt: '2026-07-31T12:00:00.000Z',
    })
    const [c] = applyMessage(
      [base],
      msg({ body: 'texto antigo corrigido', sentAt: '2026-07-20T08:00:00.000Z', editedAt: 'x' }),
    )
    expect(c!.lastMessageBody).toBe('a mais recente')
    expect(c!.lastMessageAt).toBe('2026-07-31T12:00:00.000Z')
  })

  it('mensagem nova segue contando não lida e atualizando o preview', () => {
    const [c] = applyMessage([conv()], msg({ senderId: 'b', body: 'oi de novo' }))
    expect(c!.unreadBy.a).toBe(1)
    expect(c!.lastMessageBody).toBe('oi de novo')
  })
})
