// src/pages/chat/components/MessageThread.tsx
// Caixa de mensagens do inbox: placeholder quando não há conversa selecionada,
// histórico rolável de bolhas, separado por dia, quando há.
import type { MutableRefObject } from 'react'
import { Text, useTheme } from '@kavicki/swi-design-system'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { ChatBubble } from './ChatBubble'

type ThreadItem =
  | { kind: 'day'; key: string; label: string }
  | { kind: 'message'; message: ChatMessage }

const dateOf = (d: Date) =>
  d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' })

/**
 * As mensagens com um separador antes de cada dia: "Hoje - dd/mm/aaaa" no dia
 * corrente e "dd/mm/aaaa" nos outros, sempre no fuso de quem lê. Mensagem sem
 * data de envio fica no dia da anterior.
 */
function groupByDay(messages: readonly ChatMessage[], now: Date): ThreadItem[] {
  const today = now.toDateString()
  const items: ThreadItem[] = []
  let currentDay: string | null = null
  for (const message of messages) {
    if (message.sentAt) {
      const sent = new Date(message.sentAt)
      const day = sent.toDateString()
      if (day !== currentDay) {
        currentDay = day
        const label = day === today ? `Hoje - ${dateOf(sent)}` : dateOf(sent)
        items.push({ kind: 'day', key: day, label })
      }
    }
    items.push({ kind: 'message', message })
  }
  return items
}

export function MessageThread({
  boxRef,
  contact,
  messages,
  loadError,
  emptyText,
  onEdit,
  onReport,
}: {
  // O ref mora no hook da página porque o efeito de auto-scroll roda lá
  // (depende do tamanho da lista e do contato selecionado), então desce como
  // prop em vez de ser criado aqui.
  boxRef: MutableRefObject<HTMLDivElement | null>
  contact: ChatContact | null
  messages: readonly ChatMessage[]
  loadError: boolean
  /** Conversa aberta sem nenhuma mensagem a mostrar (ex.: busca sem resultado). */
  emptyText?: string | null
  onEdit: (message: ChatMessage) => void
  onReport: (message: ChatMessage) => void
}) {
  const theme = useTheme()
  return (
    // chat-box: empty placeholder when no selection, otherwise scrollable
    // bubble history with a date separator before each day. ref drives
    // auto-scroll-to-bottom on send / contact switch.
    <div
      ref={boxRef}
      className="subtle-scrollbar"
      style={{
        flex: 1,
        // min-height: 0 unlocks overflow scroll on a flex column
        // container: without it the browser refuses to shrink the
        // box below its content height, so overflow:auto never fires.
        minHeight: 0,
        width: '100%',
        // box-sizing: border-box keeps width:100% + padding within
        // the parent's bounds (CSS default for <div> is content-box,
        // which would add the 16+16 padding ON TOP of 100% and make
        // this overflow leftward into the contact-list spacer).
        boxSizing: 'border-box',
        backgroundColor: theme.surface.standard,
        display: 'flex',
        flexDirection: 'column',
        gap: 28,
        padding: 16,
        overflowY: 'auto',
        overflowX: 'hidden',
        // justifyContent flex-start (not flex-end) so overflow extends
        // BELOW the container: that's what scrollHeight measures and
        // what `overflow: auto` can scroll. With flex-end, overflow
        // goes ABOVE the container and scrollHeight stays = clientHeight,
        // making the box appear unscrollable. Latest message visibility
        // is handled by the auto-scroll effect that owns `boxRef`.
        justifyContent: contact ? 'flex-start' : 'center',
        alignItems: 'center',
      }}
    >
      {contact && emptyText && messages.length === 0 ? (
        <Text variant="body.s" color={theme.content.medium}>
          {emptyText}
        </Text>
      ) : contact ? (
        <>
          {groupByDay(messages, new Date()).map((item) =>
            item.kind === 'day' ? (
              <Text
                key={`dia-${item.key}`}
                variant="body.s"
                color={theme.content.medium}
                style={{ textAlign: 'center', width: '100%' }}
              >
                {item.label}
              </Text>
            ) : (
              <ChatBubble
                key={item.message.id}
                message={item.message}
                contact={contact}
                onEdit={onEdit}
                onReport={onReport}
              />
            ),
          )}
        </>
      ) : (
        <Text variant="body.s" color={loadError ? theme.content.error : theme.content.medium}>
          {loadError
            ? 'Não foi possível carregar as conversas.'
            : 'Selecione uma conversa para visualizar as mensagens'}
        </Text>
      )}
    </div>
  )
}
