// Smoke test — verifies the page mounts without throwing under the
// providers it expects at runtime (theme + auth + router). Behavioural
// assertions live in dedicated tests; this guard catches regressions
// from DS bumps, route refactors, and import-graph changes.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { screen } from '@testing-library/react'
import { ChatBubble, ChatInbox } from './ChatInbox'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { clearSession, renderPage } from '@/test-utils/renderPage'

const CONTACT: ChatContact = {
  id: 'chat-test',
  name: 'Fulano de Tal',
  sector: 'Setor Norte',
  avatarUri: 'blob:avatar',
}

describe('ChatInbox', () => {
  afterEach(clearSession)

  it('renders without crashing', () => {
    expect(() => renderPage(<ChatInbox />, { route: '/chat' })).not.toThrow()
  })
})

describe('ChatBubble', () => {
  afterEach(clearSession)

  it('renders the image attachment when the message has an imageUri', () => {
    const message: ChatMessage = {
      id: 'm-img',
      text: '',
      sender: 'them',
      time: '10:30',
      imageUri: 'blob:some-attachment',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
  })

  it('does not render an image box for a text-only message', () => {
    const message: ChatMessage = {
      id: 'm-text-only',
      text: 'Sem anexo aqui.',
      sender: 'them',
      time: '10:32',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.queryByTestId('chat-bubble-image')).toBeNull()
    expect(screen.getByText('Sem anexo aqui.')).toBeTruthy()
  })

  it('renders both the image and the text when the message has both', () => {
    const message: ChatMessage = {
      id: 'm-img-text',
      text: 'Segue a foto do sensor.',
      sender: 'me',
      time: '10:31',
      imageUri: 'blob:some-attachment',
    }
    renderPage(<ChatBubble message={message} contact={CONTACT} />)
    expect(screen.getByTestId('chat-bubble-image')).toBeTruthy()
    expect(screen.getByText('Segue a foto do sensor.')).toBeTruthy()
  })
})
