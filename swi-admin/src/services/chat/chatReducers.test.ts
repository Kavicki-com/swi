import { conversationKey, applyMessage, markRead, unreadFor } from './chatReducers'
import type { Conversation, Message } from './types'

const conv = (over: Partial<Conversation> = {}): Conversation => ({
  id: 'a#b', participants: ['a', 'b'], participantNames: ['A', 'B'],
  participantSubtitles: ['', ''], participantAvatars: ['', ''],
  lastMessageBody: '', lastMessageAt: null, unreadBy: {}, ...over,
})
const msg = (over: Partial<Message> = {}): Message => ({
  id: 'm1', conversationId: 'a#b', participants: ['a', 'b'], senderId: 'b',
  body: 'oi', imageUri: null, sentAt: '2026-07-23T10:00:00.000Z', ...over,
})

describe('conversationKey', () => {
  it('ordena e junta com #', () => {
    expect(conversationKey('b', 'a')).toBe('a#b')
    expect(conversationKey('a', 'b')).toBe('a#b')
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
    const newer = conv({ id: 'a#c', participants: ['a','c'], lastMessageAt: '2026-07-22T00:00:00.000Z' })
    const out = applyMessage([older, newer], msg({ conversationId: 'a#b', sentAt: '2026-07-23T00:00:00.000Z' }))
    expect(out[0]!.id).toBe('a#b')
  })
})
describe('markRead', () => {
  it('zera unread do myId', () => {
    const [c] = markRead([conv({ unreadBy: { a: 3 } })], 'a#b', 'a')
    expect(unreadFor(c!, 'a')).toBe(0)
  })
})
