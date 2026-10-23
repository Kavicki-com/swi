// O separador de data da conversa vem do envio real de cada mensagem: um por
// dia, "Hoje - dd/mm/aaaa" para o dia corrente e "dd/mm/aaaa" para os outros.
// As datas são montadas na hora local para o teste não depender do fuso.
// vitest globals (describe/it/expect/afterEach) are available via globals: true
import { vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SwiThemeProvider } from '@kavicki/swi-design-system'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { MessageThread } from './MessageThread'

// A bolha lê o contexto do chat (menu de editar e denunciar); aqui só importa
// onde cada mensagem cai em relação aos separadores.
vi.mock('./ChatBubble', () => ({
  ChatBubble: ({ message }: { message: ChatMessage }) => <span>{message.text}</span>,
}))

const HOJE = new Date(2026, 9, 22, 15, 0)
const em = (dia: number, mes: number, hora: number) =>
  new Date(2026, mes - 1, dia, hora, 0).toISOString()

const msg = (id: string, sentAt: string | undefined): ChatMessage => ({
  id,
  text: `Mensagem ${id}`,
  sender: 'them',
  time: '10:00',
  sentAt,
})

const CONTATO: ChatContact = {
  id: 'c1',
  name: 'Romulo Cardoso',
  sector: 'Setor Leste',
  avatarUri: '',
}

const renderThread = (messages: ChatMessage[]) =>
  render(
    <SwiThemeProvider>
      <MessageThread
        boxRef={{ current: null }}
        contact={CONTATO}
        messages={messages}
        loadError={false}
        onEdit={vi.fn()}
        onReport={vi.fn()}
      />
    </SwiThemeProvider>,
  )

// Ordem do documento: separadores e mensagens como a pessoa lê, de cima a baixo.
const leitura = () =>
  screen
    .getAllByText(/^(Hoje - )?\d{2}\/\d{2}\/\d{4}$|^Mensagem /)
    .map((el) => el.textContent ?? '')

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] })
  vi.setSystemTime(HOJE)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('MessageThread: separador de data', () => {
  it('um separador por dia, com "Hoje" no dia corrente e a data nos outros', () => {
    renderThread([
      msg('1', em(20, 10, 9)),
      msg('2', em(20, 10, 18)),
      msg('3', em(21, 10, 8)),
      msg('4', em(22, 10, 7)),
      msg('5', em(22, 10, 14)),
    ])

    expect(leitura()).toEqual([
      '20/10/2026',
      'Mensagem 1',
      'Mensagem 2',
      '21/10/2026',
      'Mensagem 3',
      'Hoje - 22/10/2026',
      'Mensagem 4',
      'Mensagem 5',
    ])
  })

  it('conversa só de hoje tem um separador só, no topo', () => {
    renderThread([msg('1', em(22, 10, 7)), msg('2', em(22, 10, 8)), msg('3', em(22, 10, 9))])

    expect(leitura()).toEqual(['Hoje - 22/10/2026', 'Mensagem 1', 'Mensagem 2', 'Mensagem 3'])
  })

  it('nunca mostra a data fixa do desenho', () => {
    renderThread([msg('1', em(22, 10, 7)), msg('2', em(22, 10, 8)), msg('3', em(22, 10, 9))])

    expect(screen.queryByText('Hoje - 21/03/2026')).toBeNull()
  })

  it('mensagem sem data de envio fica no dia da anterior, sem separador próprio', () => {
    renderThread([msg('1', em(21, 10, 8)), msg('2', undefined)])

    expect(leitura()).toEqual(['21/10/2026', 'Mensagem 1', 'Mensagem 2'])
  })
})
