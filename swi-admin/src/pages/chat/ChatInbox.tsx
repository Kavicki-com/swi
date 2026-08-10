// src/pages/chat/ChatInbox.tsx
// Chat inbox: empty state and active state.
// Full-bleed page (no AppLayout sidebar). Three-column layout under a global
// header:
//   - LEFT  (358px): ConversationList, Voltar + SearchInput + scrollable
//                    contact list + Novo Chat.
//   - MID   (flex):  Pesquisar CTA top-right + MessageThread (empty
//                    placeholder when no selection, conversation bubbles when
//                    selected) + message input row with attach + Enviar CTA.
//   - RIGHT (268px): dashed empty info panel when no selection,
//                    ContactInfoPanel (avatar + mini-map + fatigue + stats)
//                    when selected.
// Estado, efeitos e handlers moram em hooks/useChatInbox; esta página é layout.
import { Pressable, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  HeaderUserInfo,
  Icon,
  Input,
  Logo,
  Text,
  useTheme,
} from '@kavicki/swi-design-system'
import { useAuth } from '@/hooks/useAuth'
import { useBreakpoint } from '@/hooks/useBreakpoint'
import { useDemoToast } from '@/lib/demoToast'
import { useMyVitals } from '@/hooks/useMyVitals'
import { ContactInfoPanel } from './components/ContactInfoPanel'
import { ConversationList } from './components/ConversationList'
import { MessageThread } from './components/MessageThread'
import { useChatInbox } from './hooks/useChatInbox'
import { ReportMessageModal } from './ReportMessageModal'
import workerA from '@/assets/avatars/worker-a.png'

export function ChatInbox() {
  const { user } = useAuth()
  const myVitals = useMyVitals()
  const theme = useTheme()
  const navigate = useNavigate()
  const breakpoint = useBreakpoint()
  const isTablet = breakpoint === 'tablet'
  const { show: showToast } = useDemoToast()
  const {
    search,
    setSearch,
    draft,
    setDraft,
    pendingImage,
    setPendingImage,
    fileInputRef,
    sending,
    newChatOpen,
    toggleNewChat,
    selectedContactId,
    filtered,
    selectedContact,
    messages,
    panelContact,
    loadStatus,
    openContact,
    handleSend,
    reportingMessage,
    setReportingMessage,
    editingId,
    startEdit,
    cancelEdit,
    handleSaveEdit,
    chatBoxRef,
  } = useChatInbox()

  return (
    <View
      testID="chat-inbox"
      style={{
        // Chat grows to fill the available viewport space with a 52 px gutter
        // at the bottom (user-approved spec). minHeight 728 = spec 88 header
        // + 640 row floors the chat at tall content height when the viewport
        // is short — the page scrolls in that case.
        // At 1366x768: minHeight kicks in, chat = 728, page scrolls ~65px.
        flex: 1,
        minHeight: 728,
        marginBottom: 52,
        flexDirection: 'column',
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
        <Pressable
          onPress={() => navigate('/')}
          accessibilityRole="link"
          accessibilityLabel="Ir para dashboard"
          testID="chat-header-logo-pressable"
        >
          <Logo type="complete" size="m" />
        </Pressable>
        <HeaderUserInfo
          bpm={myVitals.bpm}
          pressure={myVitals.pressure}
          progress={myVitals.progress}
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
          // fix matching the Sidebar gap-[16px].
          paddingHorizontal: theme.padding.xxl,
          // 1366px spec: height 640. Switched to flex:1 + minHeight so
          // taller viewports (1080+) let the chat thread breathe and shorter
          // ones still respect 480 floor. At wide MIDDLE absorbs extra width
          // naturally via flex:1.
          minHeight: 480,
          flex: 1,
          alignItems: 'stretch',
        }}
      >
        {/* LEFT column */}
        <ConversationList
          contacts={filtered}
          selectedContactId={selectedContactId}
          onSelect={openContact}
          search={search}
          onSearchChange={setSearch}
          newChatOpen={newChatOpen}
          onToggleNewChat={toggleNewChat}
          onBack={() => navigate(-1)}
        />

        {/* Spacer: 16px between LEFT and MIDDLE per the spec */}
        <View style={{ width: theme.padding.m }} />

        {/* MIDDLE column */}
        <View
          style={{
            flex: 1,
            // Container BG = theme.background per the spec. Inner chat-box
            // keeps surface.standard so it reads as a card on top of the
            // darker page-bg container (same pattern as LEFT column chips).
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

          {/* Chat Container: h-[564px] fixed height
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
            <MessageThread
              boxRef={chatBoxRef}
              contact={selectedContact}
              messages={messages}
              loadError={loadStatus === 'error'}
              onEdit={startEdit}
              onReport={setReportingMessage}
            />

            <View style={{ gap: theme.gap.s, width: '100%' }}>
              {/* Attachment preview — a small chip with the picked file's name
                  and a remove control. Shows only while an image is pending;
                  cleared on send success or via the remove Pressable. */}
              {pendingImage ? (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    alignSelf: 'flex-start',
                    gap: theme.gap.s,
                    backgroundColor: theme.surface.standard,
                    borderRadius: theme.border.radius.m,
                    paddingHorizontal: theme.padding.sm,
                    paddingVertical: theme.padding.s,
                  }}
                >
                  <Icon name="add_a_photo" size={16} color={theme.content.dark} />
                  <Text variant="body.s" color={theme.content.dark}>
                    {pendingImage.name}
                  </Text>
                  <Pressable
                    testID="chat-attach-remove"
                    accessibilityRole="button"
                    accessibilityLabel="Remover imagem"
                    onPress={() => setPendingImage(null)}
                  >
                    <Icon name="close" size={16} color={theme.content.dark} />
                  </Pressable>
                </View>
              ) : null}

              <View
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: theme.gap.m,
                  width: '100%',
                }}
              >
                {/* Hidden native file picker — triggered via the attach button
                    ref. Resets value on change so re-picking the same file
                    still fires onChange. */}
                <input
                  ref={fileInputRef}
                  data-testid="chat-file-input"
                  type="file"
                  accept="image/png,image/jpeg"
                  style={{ display: 'none' }}
                  onChange={(e) => {
                    setPendingImage(e.target.files?.[0] ?? null)
                    e.target.value = ''
                  }}
                />
                <Pressable
                  testID="chat-attach"
                  accessibilityRole="button"
                  accessibilityLabel="Anexar imagem"
                  onPress={() => fileInputRef.current?.click()}
                >
                  <Icon name="add_a_photo" size={24} color={theme.content.dark} />
                </Pressable>
                <View style={{ flex: 1 }}>
                  {/* No decorative iconRight here: the DS Input's iconRight slot
                      is inert (no press handler), so a paperclip there would be
                      a dead attach affordance. The single functional attach
                      control is the add_a_photo Pressable to the left. */}
                  <Input
                    value={draft}
                    onChangeText={setDraft}
                    placeholder="Digite aqui sua mensagem"
                  />
                </View>
                {editingId ? (
                  // Saída explícita da edição. Sem ela, quem entrou por engano
                  // fica com um CTA que não envia e nenhum jeito óbvio de sair.
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Cancelar edição"
                    onPress={cancelEdit}
                  >
                    <Icon name="close" size={24} color={theme.content.dark} />
                  </Pressable>
                ) : null}
                <Button
                  label={editingId ? 'Salvar' : 'Enviar'}
                  variant="contained"
                  iconRight={<Icon name="send" size={16} color={theme.content.light} />}
                  accessibilityLabel={editingId ? 'Salvar edição' : 'Enviar mensagem'}
                  onPress={editingId ? handleSaveEdit : handleSend}
                  disabled={sending}
                />
              </View>
            </View>
          </div>
        </View>

        {/* RIGHT column — hidden at tablet (<1024) so LEFT 358 + MIDDLE flex
            fit the narrow viewport. Contact info is reachable via the LEFT
            list or a future drawer; at desktop/wide the panel is back. */}
        {!isTablet ? (
          <>
            {/* Spacer: 16px between MIDDLE and RIGHT per the spec */}
            <View style={{ width: theme.padding.m }} />

            <View
              style={{
                width: 268,
                // Container BG = theme.background per the spec. Inner
                // user-card / map / stats card keep their own surface tokens
                // (stats card uses surface.medium) so they pop on the darker
                // container — matches the 3-column visual pattern.
                backgroundColor: theme.background,
                borderRadius: theme.border.radius.m,
                padding: theme.padding.m,
              }}
            >
              {panelContact ? (
                <ContactInfoPanel
                  contact={panelContact}
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
                  <Text
                    variant="body.s"
                    color={theme.content.medium}
                    style={{ textAlign: 'center' }}
                  >
                    Selecione uma conversa para visualizar as informações
                  </Text>
                </View>
              )}
            </View>
          </>
        ) : null}
      </View>
      {/* QA Web #9 — modal de denúncia por cima da página inteira, como o
          SupportModal. selectedContactId é o id da conversa (contact.id). */}
      {reportingMessage && selectedContactId ? (
        <ReportMessageModal
          conversationId={selectedContactId}
          message={reportingMessage}
          onClose={() => setReportingMessage(null)}
        />
      ) : null}
    </View>
  )
}
