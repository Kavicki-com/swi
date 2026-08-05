// src/pages/chat/components/ChatBubble.tsx
// Bolha de conversa do inbox: enviada (direita) e recebida (esquerda), com o
// menu de acoes (editar, copiar, denunciar, excluir) e a lapide de mensagem
// excluida. Extraida de ChatInbox.tsx sem mudanca de comportamento.
import { useState } from 'react'
import { Pressable, View } from 'react-native'
import {
  Avatar,
  Icon,
  Image,
  Popover,
  PopoverItem,
  PopoverSeparator,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import { useDemoToast } from '@/lib/demoToast'
import type { ChatContact, ChatMessage } from '@/services/chats'
import { useChat } from '@/services/chat/ChatProvider'
import workerA from '@/assets/avatars/worker-a.png'

// Inline attachment thumbnail layout box. The wrapper View clips the DS Image
// to radius.m, so both must share the exact same dimensions — keep them here.
const CHAT_IMG_W = 220
const CHAT_IMG_H = 160

// Single conversation bubble — sent (right) and received (left).
// Both share the same structure but mirror
// avatar + border color + horizontal padding.
export function ChatBubble({
  message,
  contact,
  onEdit,
  onReport,
}: {
  message: ChatMessage
  contact: ChatContact
  // Editar acontece no campo de mensagem, que mora no ChatInbox. A bolha só
  // avisa qual mensagem entrou em edição; quem guarda o modo (editingId) é o
  // hook da página, useChatInbox.
  onEdit?: (message: ChatMessage) => void
  // QA Web #9 — denunciar segue o mesmo desenho: o form mora num modal da
  // página (dentro da bolha ele seria recortado pelo overflow do quadro de
  // mensagens), a bolha só avisa qual mensagem está sendo denunciada.
  onReport?: (message: ChatMessage) => void
}) {
  const theme = useTheme()
  const { show: showToast } = useDemoToast()
  const [menuOpen, setMenuOpen] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const { deleteMessage } = useChat()
  const isMe = message.sender === 'me'
  const isDeleted = Boolean(message.deleted)
  const closeMenu = () => {
    setMenuOpen(false)
    setConfirmingDelete(false)
  }
  const confirmDelete = () => {
    closeMenu()
    void deleteMessage(contact.id, message.id).then(({ error }) => {
      // A bolha vira lápide sozinha quando o provider aplica o retorno. Só o
      // caminho de erro precisa de voz, senão o clique some sem explicação.
      if (error) showToast('Não foi possível excluir', 'Tente novamente.')
    })
  }
  const bubbleBorderColor = isMe ? theme.content.secondaryLight : theme.content.primaryLight
  const avatarUri = isMe ? workerA : contact.avatarUri
  const avatar = (
    <Avatar uri={avatarUri} customSize={40} accessibilityLabel={isMe ? 'Você' : contact.name} />
  )
  // QA Web #4 (30/07/2026): o more_vert era um <Icon> solto, sem Pressable e
  // sem onPress. Controle morto: o usuário clicava e nada acontecia.
  //
  // A primeira correção só fez o ícone copiar, porque editar e excluir não
  // existiam em lugar nenhum. Em 31/07/2026 o usuário decidiu implementá-las de
  // verdade: PATCH e DELETE no backend, editMessage/deleteMessage no
  // ChatProvider, e Popover no DS (v0.1.129, com abertura para cima na 0.1.130).
  // Por isso o controle virou menu, e não um botão de copiar.
  //
  // Quem pode o quê: só o autor edita e exclui. Sem texto não há o que editar
  // nem copiar. Mensagem excluída não tem ação nenhuma.
  const copyMessage = () => {
    const text = message.text
    if (!text) return
    const clipboard = navigator.clipboard
    if (!clipboard) {
      showToast('Não foi possível copiar', 'Selecione o texto e copie manualmente.')
      return
    }
    clipboard.writeText(text).then(
      () => showToast('Mensagem copiada'),
      () => showToast('Não foi possível copiar', 'Selecione o texto e copie manualmente.'),
    )
  }
  // Duas disputas de empilhamento, e as duas precisam ser vencidas enquanto o
  // menu está aberto:
  //   1. dentro da linha, o gatilho contra o texto que vem depois dele;
  //   2. dentro da bolha, a linha do gatilho contra o rodapé de hora/"editada".
  // Toda View do react-native-web é `position: relative; z-index: 0`, ou seja,
  // um contexto de empilhamento: irmão posterior ganha de irmão anterior, e o
  // z-index interno do painel não atravessa essa fronteira.
  const camadaDoMenu = menuOpen ? { zIndex: 1 } : null
  const moreButton = (
    <View testID="chat-bubble-menu-anchor" style={camadaDoMenu ?? undefined}>
      <Popover
        visible={menuOpen}
        onDismiss={closeMenu}
        // Cresce para o lado OPOSTO ao que a bolha encosta, não para o lado dos
        // pontinhos. Minha mensagem cola na borda direita da caixa do chat, que
        // tem overflowX hidden: crescer para a direita corta o painel fora.
        align={isMe ? 'end' : 'start'}
        accessibilityLabel="Ações da mensagem"
        testID="chat-bubble-menu"
        trigger={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Ações da mensagem"
            // Lápide não tem ação: editar e excluir não se aplicam a uma mensagem
            // que já não existe, e copiar copiaria o quê. O controle continua
            // desenhado para a bolha não mudar de forma ao ser excluída.
            onPress={isDeleted ? undefined : () => setMenuOpen((v) => !v)}
          >
            <Icon name="more_vert" size={16} color={theme.content.dark} />
          </Pressable>
        }
      >
        {confirmingDelete ? (
          // O painel TROCA de conteúdo em vez de abrir modal: excluir uma
          // mensagem não merece segunda camada, e um modal por cima tiraria de
          // vista qual bolha está prestes a sumir.
          <>
            <PopoverItem
              label="Confirmar exclusão"
              icon="delete_icon"
              tone="destructive"
              onPress={confirmDelete}
            />
            <PopoverSeparator />
            <PopoverItem label="Cancelar" icon="close" onPress={() => setConfirmingDelete(false)} />
          </>
        ) : (
          <>
            {/* Sem texto não há o que editar nem o que copiar: o backend recusa
              corpo vazio, e copiar copiaria nada. Oferecer os dois seria
              recriar o controle morto que o QA reportou. */}
            {isMe && message.text ? (
              <PopoverItem
                label="Editar"
                icon="edit"
                onPress={() => {
                  closeMenu()
                  onEdit?.(message)
                }}
              />
            ) : null}
            {message.text ? (
              <PopoverItem
                label="Copiar"
                icon="content_copy"
                onPress={() => {
                  setMenuOpen(false)
                  copyMessage()
                }}
              />
            ) : null}
            {/* QA Web #9: denunciar só a mensagem do OUTRO — o backend recusa
              denunciar a própria, e oferecer o item aqui seria recriar o
              controle morto do QA Web #4. Vale pra mensagem só de imagem
              também: o conteúdo ofensivo pode ser a foto. */}
            {!isMe ? (
              <PopoverItem
                label="Denunciar"
                icon="warning"
                tone="destructive"
                onPress={() => {
                  closeMenu()
                  onReport?.(message)
                }}
              />
            ) : null}
            {isMe ? (
              <PopoverItem
                label="Excluir"
                icon="delete_icon"
                tone="destructive"
                onPress={() => setConfirmingDelete(true)}
              />
            ) : null}
          </>
        )}
      </Popover>
    </View>
  )
  // Bubble pill — surface.standard with 1px border in the assigned color,
  // radius.l, content.dark text, drop shadow 12px y4 alpha 12%.
  const bubble = (
    <div
      data-testid="chat-bubble"
      style={{
        flex: 1,
        minWidth: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 10,
        alignItems: isMe ? 'flex-end' : 'flex-start',
        backgroundColor: theme.surface.standard,
        borderWidth: 1,
        borderStyle: 'solid',
        borderColor: bubbleBorderColor,
        borderRadius: theme.border.radius.l,
        paddingTop: theme.padding.sm,
        paddingBottom: theme.padding.sm,
        // Asymmetric padding pulls the more_vert icon closer to its side.
        paddingLeft: isMe ? theme.padding.s : theme.padding.m,
        paddingRight: isMe ? theme.padding.m : theme.padding.s,
        boxShadow: '0 4px 12px 0 rgba(29,29,29,0.12)',
        // Sem `overflow: hidden` de propósito: o painel do Popover é absoluto
        // dentro da bolha e seria recortado por ele. O anexo continua cortado
        // no raio porque tem wrapper próprio com borderRadius + overflow.
      }}
    >
      {isDeleted ? (
        // Lápide. O backend para de devolver o body na exclusão, então não há
        // o que esconder aqui: a bolha fica como registro de que houve algo.
        <View
          testID="chat-bubble-line"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.gap.s,
            width: '100%',
            ...camadaDoMenu,
          }}
        >
          {isMe ? moreButton : null}
          <Text
            variant="body.m"
            color={theme.content.medium}
            style={{ flex: 1, fontStyle: 'italic', textAlign: isMe ? 'right' : 'left' }}
          >
            Mensagem excluída
          </Text>
          {isMe ? null : moreButton}
        </View>
      ) : null}
      {!isDeleted && message.imageUri ? (
        // Inline attachment thumbnail. Fixed layout box clipped to radius.m via
        // an overflow-hidden wrapper — the DS Image primitive renders the photo
        // (content image, not a DS "icon"). alignSelf mirrors the bubble side so
        // image-only messages hug the correct edge.
        //
        // Quando NÃO há texto, o menu mora aqui: sem isso uma mensagem só com
        // foto não teria controle nenhum, e não haveria como excluí-la.
        <View
          testID={message.text ? undefined : 'chat-bubble-line'}
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.gap.s,
            alignSelf: isMe ? 'flex-end' : 'flex-start',
            // Só a linha que hospeda o menu precisa subir. Com texto, o menu
            // mora na linha de baixo, e subir esta aqui não faria nada.
            ...(message.text ? null : camadaDoMenu),
          }}
        >
          {isMe && !message.text ? moreButton : null}
          <View
            style={{
              width: CHAT_IMG_W,
              height: CHAT_IMG_H,
              borderRadius: theme.border.radius.m,
              overflow: 'hidden',
            }}
          >
            <Image
              testID="chat-bubble-image"
              source={{ uri: message.imageUri }}
              width={CHAT_IMG_W}
              height={CHAT_IMG_H}
              resizeMode="cover"
              accessibilityLabel="Imagem anexada"
            />
          </View>
          {!isMe && !message.text ? moreButton : null}
        </View>
      ) : null}
      {!isDeleted && message.text ? (
        <View
          testID="chat-bubble-line"
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            gap: theme.gap.s,
            width: '100%',
            ...camadaDoMenu,
          }}
        >
          {isMe ? moreButton : null}
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ flex: 1, textAlign: isMe ? 'right' : 'left' }}
          >
            {message.text}
          </Text>
          {isMe ? null : moreButton}
        </View>
      ) : null}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.xs,
          alignSelf: isMe ? 'flex-end' : 'flex-start',
        }}
      >
        {/* "editada" fica junto do horário, não no corpo: é metadado da
            mensagem, e no corpo competiria com o texto que a pessoa escreveu.
            Some na lápide, porque uma mensagem excluída ter sido editada antes
            não interessa a ninguém. */}
        {message.edited && !isDeleted ? (
          <Text variant="caption.xs" color={theme.content.medium}>
            editada
          </Text>
        ) : null}
        <Text variant="caption.xs" color={theme.content.dark}>
          {message.time}
        </Text>
      </View>
    </div>
  )
  return (
    <View
      testID="chat-bubble-row"
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.gap.sm,
        // O react-native-web dá `position: relative; z-index: 0` a toda View,
        // então cada bolha é um contexto de empilhamento e as seguintes pintam
        // por cima do painel desta. O z-index interno do painel não alcança
        // isso: quem precisa subir é a bolha inteira, e só enquanto está
        // aberta, para não deixar uma pilha permanente de sobreposições.
        zIndex: menuOpen ? 10 : undefined,
        // Bubble sizes to message content (with internal flex:1 + minWidth:0
        // handling long-text wrapping). Cap the whole row at 70% of the
        // chat-box width so wide viewports don't produce edge-to-edge bubbles
        // — matches WhatsApp/Telegram convention. alignSelf places sent
        // messages on the right side of the chat and received on the left,
        // overriding the chat-box's alignItems:'center' (kept for the empty
        // state) per child.
        alignSelf: isMe ? 'flex-end' : 'flex-start',
        maxWidth: '70%',
      }}
    >
      {isMe ? null : avatar}
      {bubble}
      {isMe ? avatar : null}
    </View>
  )
}
