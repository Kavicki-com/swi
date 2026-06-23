import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useJourney } from '../../../../services/journey/JourneyProvider';
import {
  AvatarGroup,
  Button,
  Icon,
  JourneyTheme,
  ProgressBar,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

import type { Task } from '../../../../services/journey/types';
import { elapsedSeconds, progressPct } from '../../../../services/journey/progress';
import { useMediaPicker } from '../../../../lib/media/useMediaPicker';
import { TaskDetailState } from '../../../../components/journey/JourneyState';

// Figma 364:17126 (idle) / 364:17434 (in-progress). Breadcrumb
// (Jornada > <task>) + task summary card + ProgressBar + Objetivo +
// Fotos + Tempo estimado + Interessados + CTA.
//
// Task data vem do JourneyProvider (services/journey, backed pelo backend),
// carregada por getTask(id) em local state. A "ativa" é só a activeTaskId do
// journey; senão renderiza idle mesmo que outra task esteja ongoing em paralelo.
// O progresso deriva das âncoras reais da task via progress.ts.

type DetailStatus = 'loading' | 'ready' | 'empty' | 'error';

// T4.1: Sub-componente memoizado que owns o tick do `now` + o cálculo de
// progresso. Antes, o setInterval rodava no TaskDetails e re-renderizava a tela
// inteira (8 sub-sections, ScrollView, Texts/Titles) por segundo. Agora só este
// componente re-renderiza 1×/s — e só quando a task está in_progress.
//
// Progresso real: in_progress tick-a o `now` 1×/s e deriva
// progressPct(elapsedSeconds(anchors, now), estMin); status não-running mostra
// o snapshot persistido (task.progressPct) estático. Valor arredondado pra int
// (a DS ProgressBar espera inteiro; progressPct retorna float).
type TaskProgressProps = {
  task: Task;
  theme: ReturnType<typeof useTheme>;
};
const TaskProgress = memo(function TaskProgress({ task, theme }: TaskProgressProps) {
  const running = task.status === 'in_progress';

  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!running) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [running]);

  const anchors = useMemo(
    () => ({
      startedAt: task.startedAt ? new Date(task.startedAt).getTime() : null,
      accumulatedSeconds: task.accumulatedSeconds,
      running,
    }),
    [task.startedAt, task.accumulatedSeconds, running],
  );

  const value = running
    ? Math.round(progressPct(elapsedSeconds(anchors, now), task.estimatedMinutes))
    : Math.round(task.progressPct);

  return (
    <View style={{ gap: theme.gap.m }}>
      <Title variant="title.xs" color={theme.content.dark}>
        Progresso da tarefa
      </Title>
      <ProgressBar
        value={value}
        color={theme.content.primary}
        bordered
        trackHeight={16}
      />
    </View>
  );
});

export default function TaskDetails() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();

  // Source of truth: JourneyProvider (shared state cross-screen). A task é
  // carregada por getTask(id) em local state; as CTAs leem state/activeTaskId.
  const {
    getTask,
    startTask,
    pauseJourney,
    resumeJourney,
    endJourney,
    addTaskPhoto,
    state: journeyState,
    activeTaskId,
  } = useJourney();

  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<DetailStatus>('loading');
  // Bump pra re-disparar o load no retry (o effect só depende de id/getTask).
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let active = true;
    // useLocalSearchParams pode devolver id undefined em runtime (rota sem
    // param). Sem id não há o que buscar — marca 'empty' direto ("Tarefa não
    // encontrada") em vez de chamar getTask(undefined).
    if (!id) {
      setStatus('empty');
      return () => {
        active = false;
      };
    }
    setStatus('loading');
    getTask(id)
      .then((t) => {
        if (!active) return;
        setTask(t);
        setStatus(t ? 'ready' : 'empty');
      })
      .catch(() => {
        if (active) setStatus('error');
      });
    return () => {
      active = false;
    };
  }, [id, getTask, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // CTA state machine: esta task só está "ativa" se ela é a activeTaskId do
  // journey. Senão renderiza idle mesmo que outra task esteja ongoing.
  const isActiveTask = activeTaskId === id;
  const taskState = isActiveTask ? journeyState : 'idle';
  const isPaused = taskState === 'paused';
  const isActive = taskState !== 'idle';

  const finishOrCancel = () => {
    endJourney();
    router.push('/(app)/journey');
  };

  const media = useMediaPicker();
  // O backend faz append em task.images; o slot tocado é informativo (a11y),
  // não posiciona a foto — por isso showPicker não precisa do índice.
  // Com os 5 slots cheios, um append viraria images[5] que nunca renderiza
  // (só images[0..4] aparecem); então quando cheio o picker não dispara.
  const photosFull = (task?.images?.length ?? 0) >= 5;
  const showPicker = async () => {
    if (photosFull) return;
    const uri = await media.showPicker();
    if (uri && id) {
      const updated = await addTaskPhoto(id, uri);
      setTask(updated);
    }
  };

  if (status !== 'ready' || !task) {
    return (
      <View style={{ flex: 1, backgroundColor: theme.background }}>
        <JourneyTheme
          gradient={require('../../../../assets/login-bg.png')}
          pattern={require('../../../../assets/smartband-bg-pattern.png')}
        />
        <TaskDetailState
          kind={status === 'ready' ? 'empty' : status}
          onRetry={status === 'error' ? reload : undefined}
        />
      </View>
    );
  }

  // Interessados — avatares reais da task (uris). O caption deriva do
  // interestedCount ("… e mais N-1 pessoas estão acompanhando essa tarefa").
  const interestedAvatars = task.interestedAvatars.map((uri, i) => ({
    uri,
    alt: `Avatar ${i + 1}`,
  }));

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../../assets/login-bg.png')}
        pattern={require('../../../../assets/smartband-bg-pattern.png')}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + theme.padding.l,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Breadcrumb: Jornada > <Task title> */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
          <Pressable
            onPress={() => router.back()}
            accessibilityRole="link"
            accessibilityLabel="Voltar para Jornada"
            style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs, paddingVertical: theme.padding.s }}
          >
            <Text variant="label.m" color={theme.content.primary}>
              Jornada
            </Text>
            <Icon name="keyboard_arrow_right" size={16} color={theme.content.primary} />
          </Pressable>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.gap.xs,
              paddingVertical: theme.padding.s,
              flexShrink: 1,
            }}
          >
            <Text
              variant="label.m"
              color={theme.content.primary}
              style={{ flexShrink: 1 }}
            >
              {task.title}
            </Text>
            {/* Figma 364:17194 — chevron also after o segundo item (não só após
                "Jornada"). Visual parity com a SectionTitle do design. */}
            <Icon name="keyboard_arrow_right" size={16} color={theme.content.primary} />
          </View>
        </View>

        {/* Task summary card (no left/right icons vs journey list) */}
        <View
          style={{
            flexDirection: 'row',
            padding: theme.padding.sm,
            backgroundColor: theme.surface.standard,
            borderRadius: theme.border.radius.m,
          }}
        >
          <View style={{ flex: 1, gap: theme.gap.s }}>
            <Title
              variant="title.xs"
              color={theme.content.dark}
              numberOfLines={1}
            >
              {task.title}
            </Title>
            <Text variant="body.s" color={theme.content.dark}>
              {task.description}
            </Text>
          </View>
        </View>

        {/* Progresso da tarefa — encapsulado em TaskProgress memoizado.
            Figma 364:17426 — bordered track (pill, border #303030 = content.medium-ish,
            padding-y 4) com fill 6px green. trackHeight 16 = padding 4*2 + fill 6 + border 1*2. */}
        <TaskProgress task={task} theme={theme} />

        {/* Objetivo principal */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Objetivo principal
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            {task.objective}
          </Text>
        </View>

        {/* Fotos da solicitação — 5 placeholders 56×56 com add_a_photo
            glifo centrado (Figma 364:17126 mostra ícone de câmera/foto
            em cada placeholder cinza). Slots inicializados de task.images. */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Fotos da solicitação
          </Title>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const uri = task.images[i];
              return (
                <Pressable
                  key={i}
                  onPress={() => showPicker()}
                  // Slot cheio não adiciona mais nada (o append iria pra um
                  // 6º que não renderiza) — desabilita o toque nesse caso.
                  disabled={!!uri && photosFull}
                  accessibilityRole="button"
                  accessibilityLabel={
                    uri
                      ? `Foto ${i + 1}`
                      : `Adicionar foto ${i + 1}`
                  }
                  style={{
                    width: 56,
                    height: 56,
                    backgroundColor: theme.surface.medium,
                    borderRadius: theme.border.radius.s,
                    alignItems: 'center',
                    justifyContent: 'center',
                    overflow: 'hidden',
                  }}
                >
                  {uri ? (
                    <Image
                      source={{ uri }}
                      style={{ width: '100%', height: '100%' }}
                      resizeMode="cover"
                    />
                  ) : (
                    <Icon name="add_a_photo" size={24} color={theme.content.medium} />
                  )}
                </Pressable>
              );
            })}
          </View>
        </View>

        {/* Tempo estimado */}
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Tempo estimado
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            {`${Math.round(task.estimatedMinutes / 60)}h até a conclusão`}
          </Text>
        </View>

        {/* Interessados */}
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Interessados
          </Title>
          <AvatarGroup
            avatars={interestedAvatars}
            totalCount={task.interestedCount}
            maxVisible={5}
            size="m"
            bordered
          />
          <Text variant="body.m" color={theme.content.dark}>
            {`Joacir Alves e mais ${task.interestedCount - 1} pessoas estão acompanhando essa tarefa`}
          </Text>
        </View>

        {/* CTA group — Figma 364:17126 idle / 364:17434 ongoing / 364:17766 pause.
            State machine local: idle → ongoing ↔ paused.
            Finalizar/Cancelar saem da tela (voltam pra /journey). */}
        {isActive ? (
          <View style={{ gap: theme.gap.m }}>
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              labelColor={theme.content.light}
              label="Finalizar tarefa"
              elevation="lg"
              // Desabilitado em paused — não pode finalizar enquanto a
              // tarefa está em pausa (user precisa retomar primeiro).
              disabled={isPaused}
              accessibilityLabel={
                isPaused
                  ? 'Finalizar tarefa (indisponível enquanto pausado)'
                  : 'Finalizar tarefa'
              }
              onPress={finishOrCancel}
            />
            <Button
              variant="outline"
              borderColor={theme.surface.accent}
              labelColor={theme.surface.accent}
              // "Fazer pausa" no ongoing; "Retomar" no paused — mesma posição,
              // mesmo Button, label/handler trocam por state.
              label={isPaused ? 'Retomar' : 'Fazer pausa'}
              accessibilityLabel={isPaused ? 'Retomar tarefa' : 'Fazer pausa'}
              onPress={() => (isPaused ? resumeJourney() : pauseJourney())}
            />
            <Button
              variant="ghost"
              labelColor={theme.content.error}
              label="Cancelar tarefa"
              accessibilityLabel="Cancelar tarefa"
              onPress={finishOrCancel}
            />
          </View>
        ) : (
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Iniciar Jornada e começar tarefa"
            elevation="lg"
            accessibilityLabel="Iniciar Jornada e começar tarefa"
            // startTask escreve no JourneyProvider: state='ongoing',
            // activeTaskId=id. Sem navegação. Quando user volta pra
            // /journey, lê o context e renderiza o layout ongoing.
            onPress={() => startTask(id ?? task.id)}
          />
        )}
      </ScrollView>
    </View>
  );
}
