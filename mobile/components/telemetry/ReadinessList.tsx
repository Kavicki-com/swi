import { View } from 'react-native';
import { Button, Step, StatusTag, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { firstUseStepTag } from '../../services/telemetry/androidFirstUse';
import {
  READINESS_COPY as COPY,
  type ReadinessAction,
  type ReadinessStep,
} from '../../services/telemetry/readiness';
import { useReadiness, useReadinessAction } from '../../services/telemetry/useReadiness';

// A lista de prontidão (readiness.ts) desenhada com o DS: Step para a posição
// e o cumprido, StatusTag para o estado e o "Opcional", Button para a ação.
// Mora fora de `app/` porque tudo ali vira rota no Expo Router. Só em
// Configurações, Monitoramento: a lista inteira, sempre, com os cumpridos
// marcados.

function stepState(pendente: boolean | null) {
  return pendente === false ? 'done' : pendente === true ? 'pending' : null;
}

function ReadinessRow({
  step,
  numero,
  onAction,
}: {
  step: ReadinessStep;
  numero: number;
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
        <StatusTag status={tag.status} label={tag.label} />
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
  onAction,
}: {
  steps: readonly ReadinessStep[];
  onAction: (acao: ReadinessAction) => void;
}) {
  const theme = useTheme();
  return (
    <View testID="readiness-list" style={{ gap: theme.gap.s, width: '100%' }}>
      <Title variant="title.xs" color={theme.content.dark}>
        {COPY.titulo}
      </Title>
      <View style={{ gap: theme.gap.m }}>
        {steps.map((step, i) => (
          <ReadinessRow key={step.id} step={step} numero={i + 1} onAction={onAction} />
        ))}
      </View>
    </View>
  );
}

/** Configurações, Monitoramento: a lista inteira, sempre. */
export function SettingsReadiness({ onChooseBand }: { onChooseBand: () => void }) {
  const { steps } = useReadiness();
  const onAction = useReadinessAction({ 'escolher-pulseira': onChooseBand });
  return <ReadinessList steps={steps} onAction={onAction} />;
}
