import { useRef } from 'react';
import { Pressable, ScrollView, TextInput, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  ChatBubble,
  Icon,
  JourneyTheme,
  Text,
  useTheme,
} from '@kavicki/swi-design-system';

// Reuse avatars from chat inbox (mobile/assets/avatars/worker-1..8.png).
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

// `me` = current user; `them` = the contact.
// DS ChatBubble convention: position='left' means bubble on the left side of
// the row (avatar on the right) — that's the OWN message (Figma uses
// content/secondary-light border, padding-right m). position='right' is the
// THEIR message (avatar on the left, content/primary-light border).
type Side = 'me' | 'them';
interface ChatMessage {
  id: string;
  from: Side;
  message: string;
  time: string;
}

const MY_AVATAR = avatarUri[0];
const THEIR_AVATAR = avatarUri[1];

const MESSAGES: ChatMessage[] = [
  // Older history (gives the chat box real overflow → topmost bubble appears
  // partially cropped at the chat-box top, matching Figma 336:8808 scroll state)
  {
    id: 'h1',
    from: 'them',
    message: 'Vamos precisar alinhar com a equipe de transporte sobre os horários.',
    time: '13:42',
  },
  {
    id: 'h2',
    from: 'me',
    message: 'Combinado. Já enviei a planilha para o pessoal do operacional.',
    time: '13:50',
  },
  {
    id: 'h3',
    from: 'them',
    message: 'Perfeito. Obrigado pelo retorno rápido.',
    time: '13:55',
  },
  {
    id: '1',
    from: 'them',
    message: 'Ainda não recebemos atualizações recentes do setor de segurança.',
    time: '14:25',
  },
  // Date separator inserted after this message (Hoje - 21/03/2026)
  {
    id: '2',
    from: 'them',
    message: 'Bom dia! Alguma novidade sobre a detonação de explosivos na área 7?',
    time: '14:25',
  },
  {
    id: '3',
    from: 'me',
    message:
      'Olá! Sim, tudo ok por aqui. Precisamos de mais explosivos para a próxima semana.',
    time: '14:57',
  },
  {
    id: '4',
    from: 'them',
    message: 'Os especialistas estão agendando uma reunião para discutir os próximos passos.',
    time: '14:25',
  },
  {
    id: '5',
    from: 'them',
    message:
      'É recomendado manter a área isolada até segunda ordem das autoridades competentes.',
    time: '14:25',
  },
];

export default function ChatThread() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { userId: _userId } = useLocalSearchParams<{ userId: string }>();
  const scrollRef = useRef<ScrollView>(null);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/reports-bg.png')}
        showDotGrid={false}
      />

      {/* Topbar — Figma 336:9131 (Voltar + Avatar contato à direita) */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
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
        <Pressable
          onPress={() => router.push('/(app)/chat/user-info')}
          accessibilityRole="button"
          accessibilityLabel="Ver perfil do contato"
        >
          {/* Figma 336:9131 — avatar com ring ciano (estilo notif/active). */}
          <Avatar
            customSize={40}
            uri={THEIR_AVATAR}
            bordered
            borderColor={theme.content.secondaryLight}
          />
        </Pressable>
      </View>

      {/* Chat section — Figma 336:9026 (gap.sm 12, w 328) */}
      <View style={{ flex: 1, alignItems: 'center', paddingTop: 16 }}>
        <View style={{ width: 328, flex: 1 }}>
          {/* Chat box — Figma 336:9029 (overflow-y-auto, gap.xl 28) */}
          <ScrollView
            ref={scrollRef}
            style={{
              flex: 1,
              backgroundColor: theme.surface.standard,
              borderRadius: theme.border.radius.m,
            }}
            contentContainerStyle={{
              padding: theme.padding.m,
              gap: theme.gap.xl,
              flexGrow: 1,
              justifyContent: 'flex-end',
            }}
            showsVerticalScrollIndicator={false}
            onContentSizeChange={() =>
              scrollRef.current?.scrollToEnd({ animated: false })
            }
          >
            {MESSAGES.map((msg, idx) => {
              const isMe = msg.from === 'me';
              return (
                <View key={msg.id}>
                  {idx === 1 ? (
                    <Text
                      variant="body.s"
                      color={theme.content.medium}
                      style={{
                        textAlign: 'center',
                        width: '100%',
                        marginBottom: theme.gap.xl,
                      }}
                    >
                      Hoje - 21/03/2026
                    </Text>
                  ) : null}
                  <ChatBubble
                    message={msg.message}
                    time={msg.time}
                    position={isMe ? 'left' : 'right'}
                    avatarUri={isMe ? MY_AVATAR : THEIR_AVATAR}
                    onMenuPress={() => {}}
                  />
                </View>
              );
            })}
          </ScrollView>

          {/* Chat input — Figma 336:9037 */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.m,
              paddingVertical: theme.gap.sm,
              paddingBottom: insets.bottom + theme.gap.sm,
            }}
          >
            <View
              style={{
                flex: 1,
                backgroundColor: theme.surface.standard,
                borderRadius: theme.border.radius.m,
                paddingHorizontal: theme.padding.sm,
                paddingVertical: theme.padding.sm,
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.m,
              }}
            >
              <TextInput
                style={{
                  flex: 1,
                  color: theme.content.dark,
                  fontFamily: theme.fontFamily.body,
                  fontSize: 14,
                }}
                placeholder="Digite aqui sua mensagem"
                placeholderTextColor={theme.content.dark}
              />
              <Icon
                name="attach_file"
                width={13}
                height={20}
                color={theme.content.dark}
              />
            </View>
            <Button
              variant="contained"
              elevation="lg"
              iconLeft={
                <Icon
                  name="send"
                  width={19}
                  height={16}
                  color={theme.content.light}
                />
              }
              accessibilityLabel="Enviar"
              onPress={() => {}}
            />
          </View>
        </View>
      </View>
    </View>
  );
}
