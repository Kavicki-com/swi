import { messageToUi, conversationToContact, directoryToContact, timeOf } from './chatMap'
import type { Conversation, Message, Contact } from './types'

const myId = 'me'
const message = (o: Partial<Message> = {}): Message => ({
  id: 'm1',
  conversationId: 'me#w1',
  participants: ['me', 'w1'],
  senderId: 'w1',
  body: 'oi',
  imageUri: null,
  sentAt: '2026-07-23T13:05:00.000Z',
  ...o,
})

describe('timeOf', () => {
  it('ISO → "HH:MM"', () => {
    expect(timeOf('2026-07-23T13:05:00.000Z')).toMatch(/^\d{2}:\d{2}$/)
  })
})
describe('messageToUi', () => {
  it('senderId===myId → "me"; senão "them"; mapeia text/imageUri/time', () => {
    expect(messageToUi(message({ senderId: 'me' }), myId).sender).toBe('me')
    const m = messageToUi(message({ senderId: 'w1', body: 'oi', imageUri: 'u' }), myId)
    expect(m.sender).toBe('them')
    expect(m.text).toBe('oi')
    expect(m.imageUri).toBe('u')
    expect(m.time).toMatch(/\d{2}:\d{2}/)
  })
  it('imageUri null → undefined (não vaza null pra bolha)', () => {
    expect(messageToUi(message(), myId).imageUri).toBeUndefined()
  })
})
describe('conversationToContact', () => {
  it('id = conversationId; nome/setor/avatar do participante que não sou eu; unread e messages', () => {
    const c: Conversation = {
      id: 'me#w1',
      participants: ['me', 'w1'],
      participantNames: ['Eu', 'Worker Um'],
      participantSubtitles: ['', 'Setor Leste'],
      participantAvatars: ['', 'av1'],
      lastMessageBody: 'oi',
      lastMessageAt: '2026-07-23T13:05:00.000Z',
      unreadBy: { me: 2 },
    }
    const ct = conversationToContact(c, [message()], myId)
    expect(ct.id).toBe('me#w1')
    expect(ct.name).toBe('Worker Um')
    expect(ct.sector).toBe('Setor Leste')
    expect(ct.avatarUri).toBe('av1')
    expect(ct.unreadCount).toBe(2)
    expect(ct.messages!.length).toBe(1)
  })
  it('unread 0 → undefined (badge some no zero)', () => {
    const c: Conversation = {
      id: 'me#w1',
      participants: ['me', 'w1'],
      participantNames: ['Eu', 'Worker Um'],
      participantSubtitles: ['', 'Setor Leste'],
      participantAvatars: ['', 'av1'],
      lastMessageBody: 'oi',
      lastMessageAt: '2026-07-23T13:05:00.000Z',
      unreadBy: {},
    }
    expect(conversationToContact(c, [], myId).unreadCount).toBeUndefined()
  })
})
describe('directoryToContact', () => {
  it('Contact do directory → ChatContact com id = conversationKey(myId, workerId), sem messages', () => {
    const d: Contact = {
      workerId: 'w9',
      name: 'Zé',
      sector: 'Norte',
      role: 'Operador',
      birthDate: null,
      bloodType: null,
      allergies: null,
      gender: null,
      avatarUri: 'a9',
    }
    const ct = directoryToContact(d, myId)
    expect(ct.id).toBe('me#w9')
    expect(ct.name).toBe('Zé')
    expect(ct.role).toBe('Operador')
  })
})
