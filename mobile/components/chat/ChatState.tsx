import { ActivityIndicator, View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

// State views for the Chat (inbox + thread) screens. Mirrors
// components/journey/JourneyState.tsx: full-screen-ish centered views that
// COMPOSE DS primitives (Title + Text + Button) + the RN ActivityIndicator (no
// DS spinner primitive exists). All spacing/colors via useTheme() — no
// hardcoded tokens. This orchestrates DS primitives; it does not replace any.
//
// One internal `CenteredState` does the layout; the inbox (`ChatInboxState`)
// and thread (`ChatThreadState`) screens reuse it via thin wrappers so the only
// difference is copy — DRY per the plan.

type StateKind = 'loading' | 'empty' | 'error';

interface CenteredStateProps {
  /** Optional title line (skipped for the bare loading view). */
  title?: string;
  /** Body copy / loading hint. */
  message: string;
  /** When set, renders a DS "Tentar novamente" Button wired to it. */
  onRetry?: () => void;
  /** Per-screen a11y label for the retry button (inbox vs thread copy).
   *  Visible label stays "Tentar novamente"; this is the screen-reader wording. */
  retryAccessibilityLabel?: string;
  /** Loading shows the spinner instead of a title. */
  loading?: boolean;
}

function CenteredState({
  title,
  message,
  onRetry,
  retryAccessibilityLabel,
  loading,
}: CenteredStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: theme.background,
        gap: theme.gap.l,
        padding: theme.padding.l,
      }}
    >
      {loading ? (
        <ActivityIndicator size="large" color={theme.content.primary} />
      ) : (
        title && (
          <Title
            variant="title.s"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            {title}
          </Title>
        )
      )}
      <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
        {message}
      </Text>
      {onRetry && (
        <Button
          variant="contained"
          label="Tentar novamente"
          elevation="lg"
          accessibilityLabel={retryAccessibilityLabel}
          onPress={onRetry}
        />
      )}
    </View>
  );
}

interface ChatInboxStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// Inbox screen (app/(app)/chat/inbox.tsx) loading/empty/error views.
export function ChatInboxState({ kind, onRetry }: ChatInboxStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando conversas…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Nenhuma conversa"
        message="Você ainda não tem conversas."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar as conversas. Tente novamente."
      onRetry={onRetry}
      retryAccessibilityLabel="Tentar carregar as conversas de novo"
    />
  );
}

interface ChatThreadStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// Thread screen (app/(app)/chat/[userId].tsx) loading/empty/error views.
// Reuses CenteredState; only the copy differs from the inbox (the empty case is
// a brand-new conversation with no messages yet).
export function ChatThreadState({ kind, onRetry }: ChatThreadStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando mensagens…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Nenhuma mensagem ainda"
        message="Envie a primeira mensagem para começar a conversa."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar as mensagens. Tente novamente."
      onRetry={onRetry}
      retryAccessibilityLabel="Tentar carregar as mensagens de novo"
    />
  );
}
