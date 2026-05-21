import { useRef, useState } from 'react';
import {
  type LayoutChangeEvent,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  ScrollView,
  type TextInput,
  View,
} from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  ChatUserCard,
  Icon,
  SearchInput,
  useTheme,
  type ChatSectionUser,
} from '@kavicki/swi-design-system';

// Local avatars copied from Figma source (mobile/assets/avatars/worker-1..8.png).
// Each user gets an avatarUri resolved via expo-asset (Metro-served path).
const avatarSrc = [
  require('../../../assets/avatars/worker-1.png'),
  require('../../../assets/avatars/worker-2.png'),
  require('../../../assets/avatars/worker-3.png'),
  require('../../../assets/avatars/worker-4.png'),
  require('../../../assets/avatars/worker-5.png'),
  require('../../../assets/avatars/worker-6.png'),
  require('../../../assets/avatars/worker-7.png'),
  require('../../../assets/avatars/worker-8.png'),
];
const avatarUri = avatarSrc.map((m) => Asset.fromModule(m).uri);

const USERS: ChatSectionUser[] = [
  { id: '1', name: 'Romulo Cardoso', subtitle: 'Setor Leste', avatarUri: avatarUri[0], unreadCount: 10 },
  { id: '2', name: 'Ezequiel Almeida', subtitle: 'Setor Leste', avatarUri: avatarUri[1], unreadCount: 2 },
  { id: '3', name: 'Josué Oliveira', subtitle: 'Setor Leste', avatarUri: avatarUri[2], unreadCount: 2 },
  { id: '4', name: 'Carlos Santos', subtitle: 'Setor Leste', avatarUri: avatarUri[3] },
  { id: '5', name: 'Antonio Carlos Figueira', subtitle: 'Setor Leste', avatarUri: avatarUri[4] },
  { id: '6', name: 'Jennifer Gomes', subtitle: 'Setor Leste', avatarUri: avatarUri[6] },
  { id: '7', name: 'Adriana Santos Almeida', subtitle: 'Setor Leste', avatarUri: avatarUri[7] },
  { id: '8', name: 'Carlos Santos', subtitle: 'Setor Leste', avatarUri: avatarUri[5] },
  { id: '9', name: 'Antonio Carlos Figueira', subtitle: 'Setor Leste', avatarUri: avatarUri[4] },
  { id: '10', name: 'Lucas Pereira', subtitle: 'Setor Oeste', avatarUri: avatarUri[0] },
  { id: '11', name: 'Bruno Silva', subtitle: 'Setor Norte', avatarUri: avatarUri[1] },
  { id: '12', name: 'Maria Rodrigues', subtitle: 'Setor Sul', avatarUri: avatarUri[6] },
  { id: '13', name: 'Felipe Costa', subtitle: 'Setor Leste', avatarUri: avatarUri[2] },
  { id: '14', name: 'Rafaela Lima', subtitle: 'Setor Oeste', avatarUri: avatarUri[7] },
  { id: '15', name: 'Diogo Ramos', subtitle: 'Setor Norte', avatarUri: avatarUri[3] },
];

export default function ChatInbox() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const searchRef = useRef<TextInput>(null);

  // Custom scrollbar geometry — Figma 332:8765 / 332:8766
  // Track: surface.medium bg, width 8, full height of scroll container
  // Thumb: surface.high bg, height = (visible/content) * track, position = scroll/maxScroll * (track - thumb)
  const [layoutH, setLayoutH] = useState(0);
  const [contentH, setContentH] = useState(0);
  const [scrollY, setScrollY] = useState(0);
  const hasScroll = contentH > layoutH;
  const thumbH = hasScroll ? Math.max(24, (layoutH / contentH) * layoutH) : 0;
  const maxScroll = Math.max(1, contentH - layoutH);
  const thumbTop = hasScroll ? (scrollY / maxScroll) * (layoutH - thumbH) : 0;

  const filtered = USERS.filter((u) =>
    u.name.toLowerCase().includes(search.toLowerCase()),
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      {/* Topbar — Figma 337:9173 */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          paddingTop: insets.top + theme.padding.s,
          paddingHorizontal: theme.padding.m,
        }}
      >
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

      {/* Chat list — Figma 332:8740. Manual layout (vs DS ChatSection wrapper)
          so the "Novo Chat" button can stick to the viewport bottom. Uses DS
          primitives (SearchInput, ChatUserCard, Button) — still DS-only. */}
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 16 }}>
        <View style={{ width: 328, flex: 1 }}>
          <SearchInput
            ref={searchRef}
            value={search}
            onChangeText={setSearch}
            placeholder="Pesquisar Contatos"
          />
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
              onScroll={(e: NativeSyntheticEvent<NativeScrollEvent>) =>
                setScrollY(e.nativeEvent.contentOffset.y)
              }
              scrollEventThrottle={16}
            >
              {filtered.map((u) => (
                <ChatUserCard
                  key={u.id}
                  name={u.name}
                  subtitle={u.subtitle}
                  avatarUri={u.avatarUri}
                  unreadCount={u.unreadCount}
                  onPress={() => router.push(`/(app)/chat/${u.id}`)}
                  fullWidth
                />
              ))}
            </ScrollView>
            {/* Custom scrollbar — Figma 332:8765 (track) + 332:8766 (thumb) */}
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
                <View
                  style={{
                    position: 'absolute',
                    left: 0,
                    right: 0,
                    top: thumbTop,
                    height: thumbH,
                    borderRadius: theme.border.radius.l,
                    backgroundColor: theme.content.medium,
                  }}
                />
              </View>
            ) : null}
          </View>
          <View
            style={{
              paddingTop: theme.gap.sm,
              paddingBottom: insets.bottom + 16,
            }}
          >
            <Button
              variant="outline"
              label="Novo Chat"
              fullWidth
              accessibilityLabel="Novo Chat — buscar contato"
              onPress={() => {
                // Demo phase: "Novo Chat" abre o campo de busca para o
                // usuário escolher um contato existente. Phase 2: tela
                // dedicada de seleção/criação de conversa.
                setSearch('');
                searchRef.current?.focus();
              }}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
