import { ActivityIndicator, View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

// State views for the Jornada/Tarefas screens. Mirrors
// components/reports/ReportsListState.tsx: full-screen-ish centered views that
// COMPOSE DS primitives (Title + Text + Button) + the RN ActivityIndicator (no
// DS spinner primitive exists). All spacing/colors via useTheme() — no
// hardcoded tokens. This orchestrates DS primitives; it does not replace any.
//
// One internal `CenteredState` does the layout; the list (`JourneyListState`)
// and detail (`TaskDetailState`) screens reuse it via thin wrappers so the only
// difference is copy — DRY per the plan.

type StateKind = 'loading' | 'empty' | 'error';

interface CenteredStateProps {
  /** Optional title line (skipped for the bare loading view). */
  title?: string;
  /** Body copy / loading hint. */
  message: string;
  /** When set, renders a DS "Tentar novamente" Button wired to it. */
  onRetry?: () => void;
  /** Per-screen a11y label for the retry button (list vs single-task copy).
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

interface JourneyListStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// List screen (app/(app)/journey/index.tsx) loading/empty/error views.
export function JourneyListState({ kind, onRetry }: JourneyListStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando tarefas…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Nenhuma tarefa hoje"
        message="Você não tem tarefas agendadas para hoje."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar as tarefas. Tente novamente."
      onRetry={onRetry}
      retryAccessibilityLabel="Tentar carregar as tarefas de novo"
    />
  );
}

interface TaskDetailStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// Detail screen (app/(app)/journey/task/[id].tsx) loading/not-found/error views.
// Reuses CenteredState; only the copy differs from the list ("não encontrada"
// for the empty/not-found case).
export function TaskDetailState({ kind, onRetry }: TaskDetailStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando tarefa…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Tarefa não encontrada"
        message="Esta tarefa não está mais disponível."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar esta tarefa. Tente novamente."
      onRetry={onRetry}
      retryAccessibilityLabel="Tentar carregar a tarefa de novo"
    />
  );
}
