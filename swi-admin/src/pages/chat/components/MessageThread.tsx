// src/pages/chat/components/MessageThread.tsx
// Caixa de mensagens do inbox: placeholder quando não há conversa selecionada,
// histórico rolável de bolhas quando há. Extraída de ChatInbox.tsx sem mudança
// de comportamento.
import type { MutableRefObject } from 'react'
import { Text, useTheme } from '@kavicki/swi-design-system'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { ChatBubble } from './ChatBubble'

export function MessageThread({
  boxRef,
  contact,
  messages,
  loadError,
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
  onEdit: (message: ChatMessage) => void
  onReport: (message: ChatMessage) => void
}) {
  const theme = useTheme()
  return (
    // chat-box: empty placeholder when no selection, otherwise scrollable
    // bubble history with the date separator after the first two
    // received/sent pair (spec placement). ref drives auto-scroll-to-bottom
    // on send / contact switch.
    <div
      ref={boxRef}
      className="subtle-scrollbar"
      style={{
        flex: 1,
        // min-height: 0 unlocks overflow scroll on a flex column
        // container — without it the browser refuses to shrink the
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
        // BELOW the container — that's what scrollHeight measures and
        // what `overflow: auto` can scroll. With flex-end, overflow
        // goes ABOVE the container and scrollHeight stays = clientHeight,
        // making the box appear unscrollable. Latest message visibility
        // is handled by the auto-scroll effect that owns `boxRef`.
        justifyContent: contact ? 'flex-start' : 'center',
        alignItems: 'center',
      }}
    >
      {contact ? (
        <>
          {messages.slice(0, 2).map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              contact={contact}
              onEdit={onEdit}
              onReport={onReport}
            />
          ))}
          {messages.length > 2 ? (
            <Text
              variant="body.s"
              color={theme.content.medium}
              style={{ textAlign: 'center', width: '100%' }}
            >
              Hoje - 21/03/2026
            </Text>
          ) : null}
          {messages.slice(2).map((m) => (
            <ChatBubble
              key={m.id}
              message={m}
              contact={contact}
              onEdit={onEdit}
              onReport={onReport}
            />
          ))}
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
