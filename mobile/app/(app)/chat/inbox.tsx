import { useMemo, useRef, useState } from 'react';
import {
  Animated,
  type LayoutChangeEvent,
  ScrollView,
  type TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  ChatUserCard,
  Icon,
  SearchInput,
  useTheme,
} from '@kavicki/swi-design-system';
import { useChat } from '../../../services/chat/ChatProvider';
import { resolveContact, unreadFor } from '../../../services/chat/chatReducers';
import { ChatInboxState } from '../../../components/chat/ChatState';

export default function ChatInbox() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { loadStatus, conversations, directory, myId, load } = useChat();
  const [search, setSearch] = useState('');
  const searchRef = useRef<TextInput>(null);
  // 'inbox' = conversas existentes (default); 'directory' = "Novo Chat" → escolhe
  // um contato do roster pra abrir/iniciar uma conversa.
  const [mode, setMode] = useState<'inbox' | 'directory'>('inbox');

  // Track: surface.medium bg, width 8, full height of scroll container.
  // Thumb: surface.high bg, height proporcional ao viewport/content ratio;
  // posição via translateY interpolado de Animated.Value (em vez de
  // useState(scrollY) que re-renderizava os ChatUserCard a 60fps).
  const [layoutH, setLayoutH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const scrollY = useRef(new Animated.Value(0)).current;
  const hasScroll = contentH > layoutH;
  const thumbH = hasScroll ? Math.max(24, (layoutH / contentH) * layoutH) : 0;
  const maxScroll = Math.max(1, contentH - layoutH);
  const thumbTranslate = scrollY.interpolate({
    inputRange: [0, maxScroll],
    outputRange: [0, hasScroll ? layoutH - thumbH : 0],
    extrapolate: 'clamp',
  });

  // Resolve cada conversa pro contato (nome/subtitle/avatar do outro participante)
  // uma vez por mudança de `conversations`/`myId`; o filtro de busca roda depois.
  const resolvedConversations = useMemo(
    () => conversations.map((c) => ({ conversation: c, contact: resolveContact(c, myId) })),
    [conversations, myId],
  );

  // Filtro recomputa quando muda o termo, o modo, ou a fonte ativa. Inbox filtra
  // pelo nome do contato resolvido; directory filtra o roster por nome.
  const inboxFiltered = useMemo(
    () =>
      resolvedConversations.filter((r) =>
        r.contact.name.toLowerCase().includes(search.toLowerCase()),
      ),
    [resolvedConversations, search],
  );
  const directoryFiltered = useMemo(
    () => directory.filter((d) => d.name.toLowerCase().includes(search.toLowerCase())),
    [directory, search],
  );

  // state-views (loading/empty/error) e no conteúdo, mantendo o chrome consistente.
  const topbar = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        paddingTop: insets.top + theme.padding.s,
        paddingHorizontal: theme.padding.m,
      }}
    >
      {/* marginLeft:-18 compensa: (a) padding-left do ghost Button
          (theme.padding.sm = 12pt) + (b) inset visual do glyph
          keyboard_arrow_left dentro do bounding box 24x24 (~6pt) = 18pt.
          Alinha a ponta do "<" com o edge do content area. */}
      <View style={{ marginLeft: -18 }}>
        <Button
          variant="ghost"
          label="Voltar"
          iconLeft={
            <Icon
              name="keyboard_arrow_left"
              size={24}
              color={theme.content.primaryLight}
            />
          }
          accessibilityLabel="Voltar"
          onPress={() => router.back()}
        />
      </View>
    </View>
  );

  // State-views: mantêm o background + topbar pra o chrome ficar consistente.
  // 'idle' é o primeiro frame do provider (o load() dispara em efeito): mostra
  // o spinner também, senão a tela abaixo afirmaria "Nenhuma conversa" antes de
  // a busca sequer começar.
  if (loadStatus === 'idle' || loadStatus === 'loading') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {topbar}
        <ChatInboxState kind="loading" />
      </View>
    );
  }
  // busca e sem "Novo Chat", então quem ainda não tinha conversa nenhuma ficava
  // sem NENHUM caminho até o diretório e o app parecia vazio de gente. O aviso
  // de caixa vazia continua, agora dentro do layout normal.
  if (loadStatus === 'error') {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        {topbar}
        <ChatInboxState kind="error" onRetry={load} />
      </View>
    );
  }

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {topbar}

      <View style={{ flex: 1, paddingTop: 16, paddingHorizontal: theme.padding.m }}>
        <View style={{ flex: 1 }}>
          <SearchInput
            ref={searchRef}
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar Contatos"
          />
          {/* Caixa vazia: o aviso ocupa a área da lista, e o rodapé com "Novo
              Chat" segue montado abaixo. Chave em `conversations.length` e não
              em loadStatus porque o status fica 'empty' mesmo depois de a
              primeira conversa chegar pelo socket. */}
          {mode === 'inbox' && conversations.length === 0 ? (
            <View style={{ flex: 1, marginTop: theme.gap.sm }}>
              <ChatInboxState kind="empty" />
            </View>
          ) : (
            <View
              style={{ flex: 1, marginTop: theme.gap.sm, flexDirection: 'row' }}
            >
              <ScrollView
                style={{ flex: 1 }}
                contentContainerStyle={{ gap: theme.gap.xs, paddingRight: theme.gap.s }}
                showsVerticalScrollIndicator={false}
                onLayout={(e: LayoutChangeEvent) =>
                  setLayoutH(e.nativeEvent.layout.height)
                }
                onContentSizeChange={(_, h) => setContentH(h)}
                onScroll={Animated.event(
                  [{ nativeEvent: { contentOffset: { y: scrollY } } }],
                  { useNativeDriver: false },
                )}
                scrollEventThrottle={16}
              >
                {mode === 'inbox'
                  ? inboxFiltered.map(({ conversation: c, contact }) => (
                      <ChatUserCard
                        key={c.id}
                        name={contact.name}
                        subtitle={contact.subtitle}
                        avatarUri={contact.avatarUri}
                        unreadCount={unreadFor(c, myId)}
                        onPress={() => router.push(`/(app)/chat/${contact.workerId}`)}
                        fullWidth
                      />
                    ))
                  : directoryFiltered.map((d) => (
                      <ChatUserCard
                        key={d.workerId}
                        name={d.name}
                        subtitle={d.sector}
                        avatarUri={d.avatarUri}
                        onPress={() => {
                          setMode('inbox');
                          router.push(`/(app)/chat/${d.workerId}`);
                        }}
                        fullWidth
                      />
                    ))}
              </ScrollView>
              {hasScroll ? (
                <View
                  pointerEvents="none"
                  style={{
                    position: 'absolute',
                    right: 0,
                    top: 0,
                    bottom: 0,
                    width: 8,
                    borderRadius: theme.border.radius.l,
                    backgroundColor: theme.surface.medium,
                    overflow: 'hidden',
                  }}
                >
                  <Animated.View
                    style={{
                      position: 'absolute',
                      left: 0,
                      right: 0,
                      top: 0,
                      height: thumbH,
                      borderRadius: theme.border.radius.l,
                      backgroundColor: theme.content.medium,
                      transform: [{ translateY: thumbTranslate }],
                    }}
                  />
                </View>
              ) : null}
            </View>
          )}
          <View
            style={{
              paddingTop: theme.gap.sm,
              paddingBottom: insets.bottom + 16,
            }}
          >
            {mode === 'inbox' ? (
              <Button
                variant="outline"
                label="Novo Chat"
                fullWidth
                accessibilityLabel="Novo Chat — buscar contato"
                onPress={() => {
                  // Entra no modo diretório: lista o roster pra escolher um
                  // contato (existente ou novo) e abre/cria a conversa.
                  setMode('directory');
                  setSearch('');
                  searchRef.current?.focus();
                }}
              />
            ) : (
              <Button
                variant="outline"
                label="Voltar às conversas"
                fullWidth
                accessibilityLabel="Voltar às conversas"
                onPress={() => {
                  setMode('inbox');
                  setSearch('');
                }}
              />
            )}
          </View>
        </View>
      </View>
    </View>
  );
}
