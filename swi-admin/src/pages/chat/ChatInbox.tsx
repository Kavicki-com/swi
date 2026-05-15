// src/pages/chat/ChatInbox.tsx
// Chat inbox — Figma 103:9924 (empty state) + 102:8997 (active state).
// Full-bleed page (no AppLayout sidebar). Three-column layout under a global
// header:
//   - LEFT  (358px): Voltar + SearchInput + scrollable contact list (selected
//                    contact gets a 2px primary-green border) + Novo Chat.
//   - MID   (flex):  Pesquisar CTA top-right + chat-box (empty placeholder
//                    when no selection, conversation bubbles when selected) +
//                    message input row with attach + Enviar CTA.
//   - RIGHT (268px): dashed empty info panel when no selection, contact
//                    profile card (avatar + mini-map + fatigue + stats)
//                    when selected.
import { useEffect, useRef, useState } from 'react'
import { Pressable, View } from 'react-native'
import { useNavigate, useParams } from 'react-router-dom'
import { useMapLibre } from '@/lib/useMapLibre'
import {
  Avatar,
  Button,
  HeaderUserInfo,
  Icon,
  Input,
  Logo,
  SearchInput,
  Text,
  Title,
  elevation,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useDemoToast } from '@/lib/demoToast'
import { chatsApi, type ChatContact, type ChatMessage } from '@/services/mockApi/chats'
import workerA from '@/assets/avatars/worker-a.png'

// Single contact row in the left list — Figma 103:9931 / 102:9571
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
  // Figma renders +9 when count > 9, otherwise zero-padded ("02", "04", ...).
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
        // Selected state — Figma 102:9571 uses border.size.m (2px) +
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

// Single conversation bubble — Figma 147:5929 (sent / right) and
// 103:10230 (received / left). Both share the same structure but mirror
// avatar + border color + horizontal padding.
function ChatBubble({ message, contact }: { message: ChatMessage; contact: ChatContact }) {
  const theme = useTheme()
  const isMe = message.sender === 'me'
  const bubbleBorderColor = isMe ? theme.content.secondaryLight : theme.content.primaryLight
  const avatarUri = isMe ? workerA : contact.avatarUri
  const avatar = (
    <Avatar uri={avatarUri} customSize={40} accessibilityLabel={isMe ? 'Você' : contact.name} />
  )
  // Bubble pill — surface.standard with 1px border in the assigned color,
  // radius.l, content.dark text, drop shadow 12px y4 alpha 12%.
  const bubble = (
    <div
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
        overflow: 'hidden',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: theme.gap.s,
          width: '100%',
        }}
      >
        {isMe ? <Icon name="more_vert" size={16} color={theme.content.dark} /> : null}
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ flex: 1, textAlign: isMe ? 'right' : 'left' }}
        >
          {message.text}
        </Text>
        {isMe ? null : <Icon name="more_vert" size={16} color={theme.content.dark} />}
      </View>
      <Text
        variant="caption.xs"
        color={theme.content.dark}
        style={{ fontSize: 8, fontWeight: '700' }}
      >
        {message.time}
      </Text>
    </div>
  )
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-end',
        gap: theme.gap.sm,
        width: '100%',
      }}
    >
      {isMe ? null : avatar}
      {bubble}
      {isMe ? avatar : null}
    </View>
  )
}

// ESRI satellite tile — same source as AdminDetails / MapsGeneral so the
// chat-inbox mini-map shares the canonical basemap.
const ESRI_SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-imagery',
      type: 'raster' as const,
      source: 'esri-imagery',
    },
  ],
}

// Mini-map inside the right-column info panel — Figma 103:9840. Renders a
// 177px-tall satellite tile with a centered LocationPin (avatar + tail),
// camera affordance top-right, and a "Mapa completo" CTA bottom-left.
function ContactMiniMap({
  contact,
  onOpenFullMap,
}: {
  contact: ChatContact
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  const lib = useMapLibre()
  const { show: showToast } = useDemoToast()
  const containerRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!lib || !containerRef.current) return
    const map = new lib.Map({
      container: containerRef.current,
      style: ESRI_SATELLITE_STYLE,
      center: [-46.633, -23.55],
      zoom: 13,
      interactive: false,
      attributionControl: false,
    })
    const wrapper = document.createElement('div')
    wrapper.style.display = 'flex'
    wrapper.style.flexDirection = 'column'
    wrapper.style.alignItems = 'center'
    const avatarEl = document.createElement('div')
    avatarEl.style.width = '40px'
    avatarEl.style.height = '40px'
    avatarEl.style.borderRadius = '999px'
    avatarEl.style.background = theme.surface.medium
    avatarEl.style.backgroundImage = `url("${contact.avatarUri}")`
    avatarEl.style.backgroundSize = '130%'
    avatarEl.style.backgroundPosition = 'center'
    avatarEl.style.boxShadow = `0 0 0 3px ${theme.surface.secondary}`
    const tail = document.createElement('div')
    tail.style.width = '0'
    tail.style.height = '0'
    tail.style.borderLeft = '6px solid transparent'
    tail.style.borderRight = '6px solid transparent'
    tail.style.borderTop = `8px solid ${theme.surface.secondary}`
    tail.style.marginTop = '-1px'
    wrapper.appendChild(avatarEl)
    wrapper.appendChild(tail)
    new lib.Marker({ element: wrapper, anchor: 'bottom' }).setLngLat([-46.633, -23.55]).addTo(map)
    return () => {
      map.remove()
    }
    // Intentionally excludes `theme.surface.secondary`: the marker DOM uses
    // theme tokens at construction; rebuilding maplibre on theme changes is
    // disruptive for a token that never moves at runtime (single dark theme).
    // Same trade-off as Admin/EmployeeDetails mini-maps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contact, lib])
  return (
    <View
      style={{
        height: 177,
        borderRadius: theme.border.radius.m,
        overflow: 'hidden',
        position: 'relative',
      }}
    >
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <View style={{ position: 'absolute', left: 12, bottom: 12 }}>
        <Button
          label="Mapa completo"
          variant="contained"
          size="small"
          onPress={onOpenFullMap}
          accessibilityLabel="Ver mapa completo"
        />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Ver câmera da posição"
        onPress={() => showToast('Câmera da posição', `Stream ao vivo de ${contact.name}`)}
        style={{
          position: 'absolute',
          right: 12,
          top: 12,
          backgroundColor: theme.surface.high,
          borderRadius: theme.border.radius.m,
          paddingHorizontal: theme.padding.sm,
          paddingVertical: theme.padding.sm,
          alignItems: 'center',
          justifyContent: 'center',
          ...elevation.sm,
        }}
      >
        <Icon name="video_camera_back" size={20} color={theme.content.dark} />
      </Pressable>
    </View>
  )
}

// Right-column profile panel — Figma 102:9672. Avatar + name + role/subtitle
// centered, mini-map, "Tempo até a fadiga total" with reversed gradient bar,
// and a stats card with Gênero / Idade / Tipo sanguíneo / Alergias.
function ContactInfoPanel({
  contact,
  onOpenFullMap,
}: {
  contact: ChatContact
  onOpenFullMap: () => void
}) {
  const theme = useTheme()
  return (
    <View style={{ flex: 1, gap: theme.gap.m }}>
      {/* User card — Figma 103:9835 — Avatar 56 + centered name + 2-line subtitle. */}
      <View style={{ alignItems: 'center', gap: theme.padding.m }}>
        <Avatar uri={contact.avatarUri} customSize={56} accessibilityLabel={contact.name} />
        <View style={{ width: '100%', alignItems: 'center', gap: 4 }}>
          <Title variant="title.xs" color={theme.content.dark}>
            {contact.name}
          </Title>
          <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
            {contact.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
            {contact.subtitle}
          </Text>
        </View>
      </View>

      {/* Mini-map */}
      <ContactMiniMap contact={contact} onOpenFullMap={onOpenFullMap} />

      {/* Fatigue total — Figma 103:9868. Label, reversed gradient bar
          (success → warning → error), then remaining time below. */}
      <View style={{ gap: theme.gap.m }}>
        <Title variant="title.xs" color={theme.content.dark}>
          Tempo até a fadiga total
        </Title>
        <div
          style={{
            height: 6,
            width: '100%',
            borderRadius: 999,
            background: `linear-gradient(90deg, ${theme.surface.success} 0%, ${theme.surface.warning} 54.327%, ${theme.surface.error} 100%)`,
          }}
        />
        <Title variant="title.xs" color={theme.content.dark}>
          {contact.fatigueRemaining ?? '—'}
        </Title>
      </View>

      {/* Stats card — Figma 103:9876. surface.standard, padding.l, radius.l,
          three rows: Gênero/Idade, Tipo sanguíneo, Alergias. */}
      <View
        style={{
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.l,
          gap: theme.gap.s,
        }}
      >
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.gap.s,
          }}
        >
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ fontWeight: '700', fontSize: 16 }}
          >
            Gênero
          </Text>
          <Icon
            name={contact.gender === 'male' ? 'male' : 'female'}
            size={20}
            color={theme.content.dark}
          />
          <Text variant="body.m" color={theme.content.dark}>
            {contact.gender === 'male' ? 'Masculino' : 'Feminino'}
          </Text>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ fontWeight: '700', fontSize: 16 }}
          >
            Idade
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {contact.age != null ? `${contact.age} anos` : '—'}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.gap.s,
          }}
        >
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ fontWeight: '700', fontSize: 16 }}
          >
            Tipo sanguíneo
          </Text>
          <Icon name="humidity_mid" size={20} color={theme.content.error} />
          <Text variant="body.m" color={theme.content.dark}>
            {contact.bloodType ?? '—'}
          </Text>
        </View>
        <View
          style={{
            flexDirection: 'row',
            flexWrap: 'wrap',
            alignItems: 'center',
            gap: theme.gap.s,
          }}
        >
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ fontWeight: '700', fontSize: 16 }}
          >
            Alergias
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {contact.allergies ?? 'Nenhuma'}
          </Text>
        </View>
      </View>
    </View>
  )
}

export function ChatInbox() {
  const { user } = useAuth()
  const theme = useTheme()
  const navigate = useNavigate()
  const { show: showToast } = useDemoToast()
  const [contacts, setContacts] = useState<ReadonlyArray<ChatContact>>([])
  const [search, setSearch] = useState('')
  const [draft, setDraft] = useState('')
  // Selection is URL-driven via /chat/:contactId so deep-links (e.g. clicks
  // from the AppLayout chat sidebar) open the right conversation. When no
  // param is present, default to chat-romulo so the active state still
  // renders by default (Figma 102:8997).
  const { contactId } = useParams<{ contactId?: string }>()
  const selectedContactId = contactId ?? 'chat-romulo'

  useEffect(() => {
    let cancelled = false
    chatsApi.list().then(({ data }) => {
      if (!cancelled && data) setContacts(data)
    })
    return () => {
      cancelled = true
    }
  }, [])

  const filtered = contacts.filter((c) =>
    search.trim() ? c.name.toLowerCase().includes(search.toLowerCase()) : true,
  )
  const selectedContact = contacts.find((c) => c.id === selectedContactId) ?? null
  const messages = selectedContact?.messages ?? []

  const handleSend = () => {
    const text = draft.trim()
    if (!text || !selectedContact) return
    const nextMessage: ChatMessage = {
      id: `local-${Date.now()}`,
      text,
      sender: 'me',
      time: new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }),
    }
    setContacts((prev) =>
      prev.map((c) =>
        c.id === selectedContact.id ? { ...c, messages: [...(c.messages ?? []), nextMessage] } : c,
      ),
    )
    setDraft('')
  }

  // Keep the chat thread anchored to the latest message: scroll to bottom
  // whenever messages append OR the user switches contacts. Older messages
  // remain reachable by scrolling up manually inside the box.
  const chatBoxRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (chatBoxRef.current) {
      chatBoxRef.current.scrollTop = chatBoxRef.current.scrollHeight
    }
  }, [messages.length, selectedContactId])

  return (
    <View
      testID="chat-inbox"
      style={{
        minHeight: '100vh' as unknown as number,
        backgroundColor: theme.background,
      }}
    >
      <View
        testID="chat-header"
        style={{
          flexDirection: 'row',
          justifyContent: 'space-between',
          alignItems: 'center',
          paddingHorizontal: theme.padding.xxl,
          paddingVertical: theme.padding.sm,
        }}
      >
        <Logo type="complete" size="m" />
        <HeaderUserInfo
          bpm={user?.bpm ?? 99}
          pressure={user?.pressure ?? '12/8'}
          progress={50}
          avatarUri={user?.avatarUri ?? workerA}
          heartIconName="heart_filled"
          pressureIconName="vitals_pulse"
          borderColor={theme.background}
          testID="chat-header-user-info"
        />
      </View>

      <View
        style={{
          flexDirection: 'row',
          // Spacing between the 3 columns uses explicit 16px spacer Views
          // (see <View style={{ width: theme.padding.m }} /> between columns
          // below) — RN-Web ignored both `gap` and `marginLeft/Right` on the
          // flex children here, so a literal spacer is the only reliable
          // fix matching Figma 102:8997 Sidebar gap-[16px].
          paddingHorizontal: theme.padding.xxl,
          height: 640,
          alignItems: 'stretch',
        }}
      >
        {/* LEFT column */}
        <View
          style={{
            width: 358,
            backgroundColor: theme.background,
            borderRadius: theme.border.radius.m,
            padding: theme.padding.s,
            gap: theme.gap.sm,
          }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Voltar"
            onPress={() => navigate(-1)}
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
            onChangeText={setSearch}
            placeholder="Pesquisar Contatos"
            onClear={() => setSearch('')}
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
            {filtered.map((c) => (
              <ContactRow
                key={c.id}
                contact={c}
                selected={c.id === selectedContactId}
                onPress={() => navigate(`/chat/${c.id}`)}
              />
            ))}
          </div>

          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Novo chat"
            onPress={() =>
              showToast('Novo chat', 'Selecione um contato à esquerda para iniciar uma conversa')
            }
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
              Novo Chat
            </Text>
          </Pressable>
        </View>

        {/* Spacer — 16px between LEFT and MIDDLE per Figma 102:8997 */}
        <View style={{ width: theme.padding.m }} />

        {/* MIDDLE column */}
        <View
          style={{
            flex: 1,
            backgroundColor: theme.background,
            borderRadius: theme.border.radius.m,
            padding: theme.padding.s,
            gap: theme.gap.sm,
          }}
        >
          <View style={{ flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button
              label="Pesquisar"
              variant="contained"
              iconLeft={<Icon name="search" size={24} color={theme.content.light} />}
              accessibilityLabel="Pesquisar mensagens"
              onPress={() => showToast('Use o campo de pesquisa de contatos à esquerda')}
            />
          </View>

          {/* Chat Container — Figma 103:9689 specifies h-[564px] fixed height
              with two children (chat-box flex:1 + chat-input shrink:0).
              We use a plain <div> here instead of <View> so the flex chain
              propagates min-height correctly to the inner scroll container;
              RN-Web's <View> wrapper was preventing the chat-box from
              shrinking below content height, breaking overflow:auto. */}
          <div
            style={{
              flex: 1,
              minHeight: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: theme.gap.s,
              alignItems: 'flex-end',
              width: '100%',
              boxSizing: 'border-box',
            }}
          >
            {/* chat-box: empty placeholder when no selection, otherwise
                scrollable bubble history with the date separator after
                the first two received/sent pair (Figma 102:8997 placement).
                ref drives auto-scroll-to-bottom on send / contact switch. */}
            <div
              ref={chatBoxRef}
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
                // is handled by the chatBoxRef auto-scroll useEffect above.
                justifyContent: selectedContact ? 'flex-start' : 'center',
                alignItems: 'center',
              }}
            >
              {selectedContact ? (
                <>
                  {messages.slice(0, 2).map((m) => (
                    <ChatBubble key={m.id} message={m} contact={selectedContact} />
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
                    <ChatBubble key={m.id} message={m} contact={selectedContact} />
                  ))}
                </>
              ) : (
                <Text variant="body.s" color={theme.content.medium}>
                  Selecione uma conversa para visualizar as mensagens
                </Text>
              )}
            </div>

            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.m,
                width: '100%',
              }}
            >
              <View style={{ flex: 1 }}>
                <Input
                  value={draft}
                  onChangeText={setDraft}
                  placeholder="Digite aqui sua mensagem"
                  iconRight={<Icon name="attach_file" size={20} color={theme.content.dark} />}
                />
              </View>
              <Button
                label="Enviar"
                variant="contained"
                iconRight={<Icon name="send" size={24} color={theme.content.light} />}
                accessibilityLabel="Enviar mensagem"
                onPress={handleSend}
              />
            </View>
          </div>
        </View>

        {/* Spacer — 16px between MIDDLE and RIGHT per Figma 102:8997 */}
        <View style={{ width: theme.padding.m }} />

        {/* RIGHT column */}
        <View
          style={{
            width: 268,
            backgroundColor: theme.background,
            borderRadius: theme.border.radius.m,
            padding: theme.padding.m,
          }}
        >
          {selectedContact ? (
            <ContactInfoPanel
              contact={selectedContact}
              onOpenFullMap={() => navigate('/maps/general')}
            />
          ) : (
            <View
              style={{
                flex: 1,
                backgroundColor: theme.surface.standard,
                borderWidth: 1,
                borderStyle: 'dashed',
                borderColor: theme.content.lightGrey,
                borderRadius: theme.border.radius.m,
                alignItems: 'center',
                justifyContent: 'center',
                paddingHorizontal: theme.padding.m,
                paddingVertical: theme.padding.s,
              }}
            >
              <Text variant="body.s" color={theme.content.medium} style={{ textAlign: 'center' }}>
                Selecione uma conversa para visualizar as informações
              </Text>
            </View>
          )}
        </View>
      </View>
    </View>
  )
}
