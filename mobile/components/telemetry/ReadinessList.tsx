import type { ReactNode } from 'react';
import { ScrollView, View } from 'react-native';
import { Button, Step, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { firstUseStepTag } from '../../services/telemetry/androidFirstUse';
import {
  dashboardShowsReadiness,
  READINESS_COPY as COPY,
  requiredPending,
  type ReadinessAction,
  type ReadinessStep,
} from '../../services/telemetry/readiness';
import {
  useReadiness,
  useReadinessAck,
  useReadinessAction,
} from '../../services/telemetry/useReadiness';

// A lista de prontidão (readiness.ts) desenhada com o DS: Step para a posição
// e o cumprido, StatusTag para o estado e o "Opcional", Button para a ação.
// Mora fora de `app/` porque tudo ali vira rota no Expo Router.
//
// - No dashboard, só os passos abertos, no lugar da linha de estado, enquanto
//   falta obrigatório ou falta opcional sem "Entendi".
// - Em Configurações, Monitoramento, a lista inteira, sempre, com os
//   cumpridos marcados.

// No dashboard a lista divide a altura com o hero e o rodapé; com muitos
// passos abertos ela rola por dentro, para o rodapé não sair da tela.
const DASHBOARD_LIST_MAX_HEIGHT = 168;

function stepState(pendente: boolean | null) {
  return pendente === false ? 'done' : pendente === true ? 'pending' : null;
}

function ReadinessRow({
  step,
  numero,
  completa,
  onAction,
}: {
  step: ReadinessStep;
  numero: number;
  completa: boolean;
  onAction: (acao: ReadinessAction) => void;
}) {
  const theme = useTheme();
  const copy = COPY.passos[step.id];
  const cumprido = step.pendente === false;
  const tag = firstUseStepTag(stepState(step.pendente));
  return (
    <View testID={`readiness-${step.id}`} style={{ gap: theme.gap.s }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <Step
          state={cumprido ? 'done' : 'default'}
          number={numero}
          accessibilityLabel={`Passo ${numero}, ${tag.label}`}
        />
        <View style={{ flex: 1 }}>
          <Text variant="body.s" color={theme.content.dark}>
            {copy.titulo}
          </Text>
        </View>
      </View>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: theme.gap.s }}>
        {completa ? <StatusTag status={tag.status} label={tag.label} /> : null}
        {step.obrigatorio ? null : <StatusTag status="info" label={COPY.opcional} />}
      </View>
      {step.id === 'BIRTH_DATE' && step.pendente === true ? (
        <Text variant="caption.s" color={theme.content.dark}>
          {COPY.semNascimento}
        </Text>
      ) : null}
      {step.pendente === true ? (
        <Button
          variant="outline"
          size="small"
          label={copy.acao}
          borderColor={theme.content.primary}
          borderWidth="m"
          labelColor={theme.content.primary}
          onPress={() => onAction(step.acao)}
        />
      ) : null}
    </View>
  );
}

export function ReadinessList({
  steps,
  completa,
  onAction,
  onAcknowledge,
}: {
  steps: readonly ReadinessStep[];
  /** A lista inteira, com os cumpridos (Configurações); senão, só os abertos. */
  completa: boolean;
  onAction: (acao: ReadinessAction) => void;
  /** "Entendi": só no dashboard, e só quando faltam apenas opcionais. */
  onAcknowledge?: () => void;
}) {
  const theme = useTheme();
  const numerados = steps.map((step, i) => ({ step, numero: i + 1 }));
  const visiveis = completa ? numerados : numerados.filter(({ step }) => step.pendente === true);
  const linhas = visiveis.map(({ step, numero }) => (
    <ReadinessRow key={step.id} step={step} numero={numero} completa={completa} onAction={onAction} />
  ));
  return (
    <View testID="readiness-list" style={{ gap: theme.gap.s, width: '100%' }}>
      <Title variant="title.xs" color={theme.content.dark}>
        {COPY.titulo}
      </Title>
      {completa ? (
        <View style={{ gap: theme.gap.m }}>{linhas}</View>
      ) : (
        <ScrollView
          style={{ maxHeight: DASHBOARD_LIST_MAX_HEIGHT }}
          contentContainerStyle={{ gap: theme.gap.m }}
          nestedScrollEnabled
        >
          {linhas}
        </ScrollView>
      )}
      {onAcknowledge && !requiredPending(steps) ? (
        <Button variant="contained" size="small" label={COPY.entendi} onPress={onAcknowledge} />
      ) : null}
    </View>
  );
}

/**
 * O dashboard no Android: a lista no lugar de `children` (a linha de estado)
 * enquanto ela deve aparecer; senão, `children`.
 */
export function DashboardReadiness({ children }: { children: ReactNode }) {
  const { steps } = useReadiness();
  const { acknowledged, acknowledge } = useReadinessAck(steps);
  const onAction = useReadinessAction();
  // Antes de ler o "Entendi", só obrigatório pendente mostra a lista: a lista
  // só de opcionais piscaria para quem já tocou.
  const mostra = acknowledged === null ? requiredPending(steps) : dashboardShowsReadiness(steps, acknowledged);
  if (!mostra) return <>{children}</>;
  return <ReadinessList steps={steps} completa={false} onAction={onAction} onAcknowledge={acknowledge} />;
}

/** Configurações, Monitoramento: a lista inteira, sempre. */
export function SettingsReadiness({ onChooseBand }: { onChooseBand: () => void }) {
  const { steps } = useReadiness();
  const onAction = useReadinessAction({ 'escolher-pulseira': onChooseBand });
  return <ReadinessList steps={steps} completa onAction={onAction} />;
}
