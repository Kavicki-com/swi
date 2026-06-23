import { ActivityIndicator, View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

// State views for the Relatórios screens. Mirrors the vitals state views
// (components/vitals/Vitals{Loading,Empty,Error}State.tsx): full-screen-ish
// centered views that COMPOSE DS primitives (Title + Text + Button) + the RN
// ActivityIndicator (no DS spinner primitive exists). All spacing/colors via
// useTheme() — no hardcoded tokens. This orchestrates DS primitives; it does
// not replace any.
//
// One internal `CenteredState` does the layout; the list (`ReportsListState`)
// and detail (`ReportDetailState`) screens reuse it via thin wrappers so the
// only difference is copy — DRY per the plan.

type StateKind = 'loading' | 'empty' | 'error';

interface CenteredStateProps {
  /** Optional title line (skipped for the bare loading view). */
  title?: string;
  /** Body copy / loading hint. */
  message: string;
  /** When set, renders a DS "Tentar novamente" Button wired to it. */
  onRetry?: () => void;
  /** Loading shows the spinner instead of a title. */
  loading?: boolean;
}

function CenteredState({ title, message, onRetry, loading }: CenteredStateProps) {
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
          accessibilityLabel="Tentar carregar os relatórios de novo"
          onPress={onRetry}
        />
      )}
    </View>
  );
}

interface ReportsListStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// List screen (app/(app)/reports/index.tsx) loading/empty/error views.
export function ReportsListState({ kind, onRetry }: ReportsListStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando relatórios…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Nenhum relatório ainda"
        message="Crie um novo relatório para começar."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar os relatórios. Tente novamente."
      onRetry={onRetry}
    />
  );
}

interface ReportDetailStateProps {
  kind: StateKind;
  /** Required for kind==='error'; ignored otherwise. */
  onRetry?: () => void;
}

// Detail screen (app/(app)/reports/[id].tsx) loading/not-found/error views.
// Reuses CenteredState; only the copy differs from the list ("não encontrado"
// for the empty/not-found case).
export function ReportDetailState({ kind, onRetry }: ReportDetailStateProps) {
  if (kind === 'loading') {
    return <CenteredState loading message="Carregando relatório…" />;
  }
  if (kind === 'empty') {
    return (
      <CenteredState
        title="Relatório não encontrado"
        message="Este relatório não está mais disponível."
      />
    );
  }
  return (
    <CenteredState
      title="Não foi possível carregar"
      message="Houve um problema ao buscar este relatório. Tente novamente."
      onRetry={onRetry}
    />
  );
}
