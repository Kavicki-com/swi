import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, ScrollView, TextInput, View } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  ChatBubble,
  Icon,
  JourneyTheme,
  useTheme,
} from '@kavicki/swi-design-system';
import { useMediaPicker } from '../../../lib/media/useMediaPicker';
import { useChat } from '../../../services/chat/ChatProvider';
import { resolveContact } from '../../../services/chat/chatReducers';
import { ChatThreadState } from '../../../components/chat/ChatState';
import type { Message } from '../../../services/chat/types';

// `me` = current user; `them` = the contact.
// DS ChatBubble convention: position='left' means bubble on the left side of
// the row (avatar on the right) — that's the OWN message (Figma uses
// content/secondary-light border, padding-right m). position='right' is the
// THEIR message (avatar on the left, content/primary-light border).

// "HH:mm" local de um ISO datetime — substitui o `time` literal que vinha no seed.
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

// T4.2: noop estável pra onMenuPress — antes era `() => {}` inline, criando
// nova função por bubble por render. ChatBubble memoizado consegue skipar
// re-render só com handler estável.
const noop = () => {};

// MessageItem encapsula 1 mensagem. memo + props primitivas → os ChatBubble não
// re-renderizam quando o ChatThread re-renderiza por mudança de keyboard insets.
type MessageItemProps = {
  msg: Message;
  myId: string;
  myAvatar: string | undefined;
  theirAvatar: string | undefined;
};
const MessageItem = memo(function MessageItem({
  msg,
  myId,
  myAvatar,
  theirAvatar,
}: MessageItemProps) {
  const isMe = msg.senderId === myId;
  return (
    <ChatBubble
      message={msg.body}
      time={fmtTime(msg.sentAt)}
      position={isMe ? 'left' : 'right'}
      avatarUri={isMe ? myAvatar : theirAvatar}
      onMenuPress={noop}
      fullWidth
    />
  );
});

export default function ChatThread() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { userId } = useLocalSearchParams<{ userId: string }>();
  const scrollRef = useRef<ScrollView>(null);

  const { myId, keyFor, messagesFor, openConversation, send, conversations, directory } =
    useChat();
  const convId = keyFor(userId);

  // Carrega o histórico da conversa ao abrir. `status` tem três valores para
  // distinguir "ainda carregando" de "carregou e está vazia" (messagesFor não
  // distingue) E de "falhou" — uma rejeição precisa cair em 'error' (com retry),
  // não em 'ready' (que renderizaria como conversa vazia e mascararia a falha).
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  // `load` é reusado pelo botão "Tentar novamente" do estado de erro.
  // .then(onOk, onErr) — NÃO .finally — para que a rejeição termine em 'error'
  // e o ChatThreadState kind="error" + onRetry fiquem alcançáveis (com .finally
  // toda falha caía em 'ready' e renderizava como conversa vazia).
  const load = useCallback(() => {
    setStatus('loading');
    openConversation(convId).then(() => setStatus('ready'), () => setStatus('error'));
  }, [convId, openConversation]);
  useEffect(() => {
    load();
  }, [load]);

  // Cabeçalho do contato: conversa existente → resolveContact; conversa nova
  // (ainda sem registro) → cai no diretório pelo workerId. Avatar "me" vem do
  // próprio registro do diretório se existir, senão reusa o avatar do contato.
  const header = useMemo(() => {
    const conv = conversations.find((c) => c.id === convId);
    if (conv) return resolveContact(conv, myId);
    const d = directory.find((x) => x.workerId === userId);
    return { workerId: userId, name: d?.name ?? '', subtitle: d?.sector ?? '', avatarUri: d?.avatarUri ?? '' };
  }, [conversations, convId, myId, directory, userId]);
  const theirAvatar = header.avatarUri;
  const myAvatar = useMemo(
    () => directory.find((d) => d.workerId === myId)?.avatarUri ?? theirAvatar,
    [directory, myId, theirAvatar],
  );

  const messages = messagesFor(convId);

  // Anexo selecionado via attach_file no input — agora enviado de verdade via
  // send(...) como imageUri (mock = uri local; a API real sobe o arquivo e devolve a uri).
  const [pendingAttachment, setPendingAttachment] = useState<string | null>(null);
  const [text, setText] = useState('');

  const media = useMediaPicker();
  const showAttachmentPicker = async () => {
    const uri = await media.showPicker();
    if (uri) setPendingAttachment(uri);
  };

  const onSend = () => {
    // Não envia enquanto a conversa não terminou de abrir: o provider só faz
    // live-append depois do openConversation, então um tap durante o loading
    // (ou após falha) descartaria a mensagem silenciosamente.
    if (status !== 'ready') return;
    const body = text.trim();
    if (!body && !pendingAttachment) return;
    send(convId, body, pendingAttachment ?? undefined);
    setText('');
    setPendingAttachment(null);
    // A mensagem aparece ao vivo via a subscription do provider (não anexar à mão).
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/login-bg.png')}
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
        <Pressable
          onPress={() =>
            router.push({ pathname: '/(app)/chat/user-info', params: { userId } })
          }
          accessibilityRole="button"
          accessibilityLabel="Ver perfil do contato"
        >
          {/* Figma 336:9131 — avatar com ring ciano (estilo notif/active). */}
          <Avatar
            customSize={40}
            uri={theirAvatar}
            bordered
            borderColor={theme.content.secondaryLight}
          />
        </Pressable>
      </View>

      {/* Chat section — Figma 336:9026 (gap.sm 12). Width era 328 fixo;
          mudado pra esticar via paddingHorizontal:theme.padding.m (match
          Journey pattern). */}
      {/* O teclado subia POR CIMA do compositor: a tela não tinha tratamento
          nenhum e a pessoa digitava às cegas (QA no aparelho, 2026-07-27).
          KeyboardAvoidingView em vez de scroll empurrado — num chat o
          compositor é fixo no rodapé, e o que precisa acontecer é ele SUBIR
          com o teclado, mantendo as mensagens visíveis acima. */}
      <KeyboardAvoidingView
        behavior="padding"
        style={{ flex: 1, paddingTop: 16, paddingHorizontal: theme.padding.m }}
      >
        <View style={{ flex: 1 }}>
          {/* Estado de carregamento / erro / conversa nova vazia. Mantém o
              chrome (background + topbar acima) e troca só o miolo. */}
          {status === 'loading' ? (
            <ChatThreadState kind="loading" />
          ) : status === 'error' ? (
            <ChatThreadState kind="error" onRetry={load} />
          ) : messages.length === 0 ? (
            <ChatThreadState kind="empty" />
          ) : (
            /* Chat box — Figma 336:9029 (overflow-y-auto, gap.xl 28) */
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
              {messages.map((msg) => (
                <MessageItem
                  key={msg.id}
                  msg={msg}
                  myId={myId}
                  myAvatar={myAvatar}
                  theirAvatar={theirAvatar}
                />
              ))}
            </ScrollView>
          )}

          {/* Pending attachment preview — surge acima do input quando user
              anexa foto via attach_file. Tap para remover. É enviado de verdade
              no próximo send(...) como imageUri. */}
          {pendingAttachment ? (
            <Pressable
              onPress={() => setPendingAttachment(null)}
              accessibilityRole="button"
              accessibilityLabel="Remover anexo"
              style={{
                marginTop: theme.gap.sm,
                alignSelf: 'flex-start',
                width: 80,
                height: 80,
                borderRadius: theme.border.radius.s,
                overflow: 'hidden',
                backgroundColor: theme.surface.standard,
              }}
            >
              <Image
                source={{ uri: pendingAttachment }}
                style={{ width: '100%', height: '100%' }}
                resizeMode="cover"
              />
            </Pressable>
          ) : null}

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
                value={text}
                onChangeText={setText}
                onSubmitEditing={onSend}
                returnKeyType="send"
              />
              <Pressable
                onPress={showAttachmentPicker}
                accessibilityRole="button"
                accessibilityLabel="Anexar arquivo"
                hitSlop={8}
              >
                <Icon
                  name="attach_file"
                  width={13}
                  height={20}
                  color={theme.content.dark}
                />
              </Pressable>
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
              onPress={onSend}
            />
          </View>
        </View>
      </KeyboardAvoidingView>
    </View>
  );
}
