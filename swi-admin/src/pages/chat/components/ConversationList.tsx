// src/pages/chat/components/ConversationList.tsx
// Coluna esquerda do inbox: Voltar + busca + lista rolável de contatos
// (o selecionado ganha borda verde de 2px) + alternador de Novo Chat.
// Extraída de ChatInbox.tsx sem mudança de comportamento.
import { Pressable, View } from 'react-native'
import { Avatar, Icon, SearchInput, Text, useTheme } from '@kavicki/swi-design-system'
import type { ChatContact } from '@/services/chats'

// Single contact row in the left list.
// user-message-card. surface.standard 60h pill at radius.s with 8px padding;
// avatar + name/sector stacked left, optional unread badge (surface.error
// pill 28×28) right. When selected, gets a 2px primary-green border.
function ContactRow({
  contact,
  selected,
  onPress,
}: {
  contact: ChatContact
  selected: boolean
  onPress: () => void
}) {
  const theme = useTheme()
  // The spec renders +9 when count > 9, otherwise zero-padded ("02", "04", ...).
  const badgeText =
    contact.unreadCount && contact.unreadCount > 9
      ? '+9'
      : contact.unreadCount
        ? String(contact.unreadCount).padStart(2, '0')
        : null
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Conversar com ${contact.name}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.s,
        height: 60,
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        paddingHorizontal: theme.padding.s,
        paddingVertical: theme.padding.s,
        // Selected state uses border.size.m (2px) +
        // content.primary green. We pre-reserve 2px when not selected with
        // a transparent border so the row height stays stable across states.
        borderWidth: 2,
        borderColor: selected ? theme.surface.primary : 'transparent',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.padding.s, flex: 1 }}>
        <Avatar uri={contact.avatarUri} customSize={40} accessibilityLabel={contact.name} />
        <View style={{ flexDirection: 'column' }}>
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {contact.name}
          </Text>
          <Text variant="body.s" color={theme.content.dark}>
            {contact.sector}
          </Text>
        </View>
      </View>
      {badgeText ? (
        <View
          accessibilityLabel={`${contact.unreadCount} mensagens não lidas`}
          style={{
            width: 28,
            height: 28,
            borderRadius: 999,
            backgroundColor: theme.surface.error,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="body.s" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {badgeText}
          </Text>
        </View>
      ) : null}
    </Pressable>
  )
}

export function ConversationList({
  contacts,
  selectedContactId,
  onSelect,
  search,
  onSearchChange,
  newChatOpen,
  onToggleNewChat,
  onBack,
}: {
  contacts: readonly ChatContact[]
  selectedContactId?: string
  onSelect: (id: string) => void
  search: string
  onSearchChange: (value: string) => void
  newChatOpen: boolean
  onToggleNewChat: () => void
  onBack: () => void
}) {
  const theme = useTheme()
  return (
    <View
      style={{
        width: 358,
        // Container BG = theme.background (page bg ~#171717) per the
        // spec. The contact chips inside use surface.standard (~#1f1f1f),
        // so they pop visually as cards on the darker container — same
        // pattern the spec applies to all 3 columns (LEFT/MIDDLE/RIGHT).
        backgroundColor: theme.background,
        borderRadius: theme.border.radius.m,
        padding: theme.padding.s,
        gap: theme.gap.sm,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Voltar"
        onPress={onBack}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 4,
          paddingHorizontal: theme.padding.sm,
          paddingVertical: theme.padding.sm,
          borderRadius: theme.border.radius.m,
        }}
      >
        <Icon name="keyboard_arrow_left" size={16} color={theme.content.primaryLight} />
        <Text
          variant="body.m"
          color={theme.content.primaryLight}
          style={{ fontFamily: theme.fontFamily.title, fontWeight: '700' }}
        >
          Voltar
        </Text>
      </Pressable>

      <SearchInput
        value={search}
        onChangeText={onSearchChange}
        placeholder="Pesquisar Contatos"
        onClear={() => onSearchChange('')}
      />

      <div
        className="no-scrollbar"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
          overflowX: 'hidden',
        }}
      >
        {contacts.map((c) => (
          <div
            key={c.id}
            style={{
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              viewTransitionName: `chat-card-${c.id}`,
            }}
          >
            <ContactRow
              contact={c}
              selected={c.id === selectedContactId}
              onPress={() => onSelect(c.id)}
            />
          </div>
        ))}
      </div>

      <Pressable
        accessibilityRole="button"
        accessibilityLabel={newChatOpen ? 'Cancelar novo chat' : 'Novo chat'}
        onPress={onToggleNewChat}
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 4,
          paddingHorizontal: theme.padding.sm,
          paddingVertical: theme.padding.sm,
          borderRadius: theme.border.radius.m,
        }}
      >
        <Text variant="body.m" color={theme.content.primaryLight} style={{ fontWeight: '700' }}>
          {newChatOpen ? 'Cancelar' : 'Novo Chat'}
        </Text>
      </Pressable>
    </View>
  )
}
