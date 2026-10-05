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
  Toast,
  useTheme,
} from '@kavicki/swi-design-system';
import {
  requestAlwaysPermission,
  requestTrackingPermission,
} from '../../../../services/positions/trackingPermission';

import type { Task } from '../../../../services/journey/types';
import { elapsedSeconds, progressPct } from '../../../../services/journey/progress';
import { useMediaPicker } from '../../../../lib/media/useMediaPicker';
import { errorMessage } from '../../../../lib/errors/errorMessage';
import { TaskDetailState } from '../../../../components/journey/JourneyState';
import { QUEUE_FULL_TITLE } from '../../../../services/outbox/sendCopy';
import type { EnqueueResult } from '../../../../services/outbox/sendQueue';

// (Jornada > <task>) + task summary card + ProgressBar + Objetivo +
// Fotos + Tempo estimado + Interessados + CTA.
//
// Task data vem do JourneyProvider (services/journey, backed pelo backend). A
// tarefa que já está na lista da jornada abre por ela, sem ir ao servidor: é o
// que deixa iniciar e concluir sem sinal. Fora da lista (link direto), é
// carregada por getTask(id) em local state. A "ativa" é só a activeTaskId do
// journey; senão renderiza idle mesmo que outra task esteja ongoing em paralelo.
// O progresso deriva das âncoras reais da task via progress.ts.
//
// As ações passam pela fila de envios e valem na tela na hora do toque.

type DetailStatus = 'loading' | 'ready' | 'empty' | 'error';

type Notice = { variant: 'warning' | 'error'; title: string };
const QUEUE_FULL: Notice = { variant: 'warning', title: QUEUE_FULL_TITLE };

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
    tasks,
    startTask,
    completeTask,
    cancelTask,
    pauseJourney,
    resumeJourney,
    addTaskPhoto,
    state: journeyState,
    activeTaskId,
  } = useJourney();

  const [task, setTask] = useState<Task | null>(null);
  const [status, setStatus] = useState<DetailStatus>('loading');
  // Bump pra re-disparar o load no retry (o effect só depende de id/getTask).
  const [reloadKey, setReloadKey] = useState(0);
  // CTA de mutação (finalizar/cancelar): trava re-toques e segura a navegação até
  // o backend confirmar. Sem isto, uma falha de rede/token era engolida e o worker
  // voltava pra /journey achando que concluiu (a ação real não aconteceu).
  const [submitting, setSubmitting] = useState(false);
  const [ctaError, setCtaError] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [locationOff, setLocationOff] = useState(false);

  const listed = id ? tasks.some((t) => t.id === id) : false;

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
    // Na lista da jornada: abre por ela, com ou sem sinal. Se a tarefa sair da
    // lista depois (a pessoa saiu da ordem), a busca roda e diz o que houve.
    if (listed) {
      setStatus('ready');
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
  }, [id, getTask, reloadKey, listed]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  // CTA state machine: esta task só está "ativa" se ela é a activeTaskId do
  // journey. Senão renderiza idle mesmo que outra task esteja ongoing.
  const isActiveTask = activeTaskId === id;
  const taskState = isActiveTask ? journeyState : 'idle';
  const isPaused = taskState === 'paused';
  const isActive = taskState !== 'idle';

  const media = useMediaPicker();

  // A cópia viva do provider manda: iniciar, pausar e finalizar nesta tela
  // aparecem na hora. O snapshot local só serve à tarefa que não está na lista.
  const liveTask = (id ? tasks.find((t) => t.id === id) : undefined) ?? task;

  if (status !== 'ready' || !liveTask) {
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

  // O backend faz append em task.images; o slot tocado é informativo (a11y),
  // não posiciona a foto — por isso showPicker não precisa do índice.
  // Com os 5 slots cheios, um append viraria images[5] que nunca renderiza
  // (só images[0..4] aparecem); então quando cheio o picker não dispara.
  // Lê de liveTask pra o full-guard acompanhar a contagem real (provider).
  const photosFull = liveTask.images.length >= 5;
  const showPicker = async () => {
    if (photosFull) return;
    const uri = await media.showPicker();
    if (!uri) return;
    // A foto entra na fila e aparece na hora pela cópia local; sobe quando
    // houver sinal. Recusada na entrada (sumiu, passa de 15 MB), diz o motivo.
    try {
      if ((await addTaskPhoto(liveTask, uri)) === 'full') setNotice(QUEUE_FULL);
    } catch (e) {
      setNotice({
        variant: 'error',
        title: errorMessage(e, `Não foi possível enviar a foto da tarefa "${liveTask.title}".`),
      });
    }
  };

  // ordem (uris). O caption deriva do responsibleCount ("<1º nome> e mais N-1
  // pessoas estão acompanhando essa tarefa").
  const responsibleAvatars = liveTask.responsibleAvatars.map((uri, i) => ({
    uri,
    alt: liveTask.responsibleNames[i],
  }));

  // Finalizar/Cancelar operam SÓ neste item — o turno segue rodando (o backend
  // não encerra o turno). Concluir marca done; cancelar devolve pra pending.
  // A ação entra na fila e vale na hora; só navega pra /journey se ela entrou.
  // Fila cheia ou sessão fechada: fica na tela e avisa (a ação é auditada, não
  // pode falhar em silêncio). `submitting` trava re-toque durante o voo.
  const runCta = async (mutate: () => Promise<EnqueueResult>, failMsg: string) => {
    if (submitting) return;
    setSubmitting(true);
    setCtaError(null);
    try {
      if ((await mutate()) === 'full') {
        setNotice(QUEUE_FULL);
        return;
      }
      router.push('/(app)/journey');
    } catch {
      setCtaError(failMsg);
    } finally {
      setSubmitting(false);
    }
  };
  // A jornada liga o GPS em segundo plano (useJourneyTracking), então a
  // permissão é pedida aqui, antes. Negada, a jornada inicia do mesmo jeito:
  // o trabalho não pode depender do GPS. O aviso sai só sem a permissão de
  // uso; sem o "Sempre" o iPhone ainda rastreia enquanto o app não fecha.
  // `submitting` trava o segundo toque enquanto o sistema pergunta.
  const startJourney = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      const permission = await requestTrackingPermission();
      setLocationOff(permission === 'denied');
      if ((await startTask(liveTask)) === 'full') {
        setNotice(QUEUE_FULL);
        return;
      }
    } catch {
      // Sem sessão aberta a ação não entra na fila e a tela não muda.
      return;
    } finally {
      setSubmitting(false);
    }
    // O "Sempre" vem com a jornada já iniciada e sem segurar o botão: para
    // quem já respondeu, o pedido só volta depois de um prazo do sistema.
    void requestAlwaysPermission();
  };
  const finishTask = () => runCta(() => completeTask(liveTask), 'Não foi possível finalizar a tarefa. Tente novamente.');
  const cancelCurrentTask = () => runCta(() => cancelTask(liveTask), 'Não foi possível cancelar a tarefa. Tente novamente.');
  const toggleShift = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      if ((await (isPaused ? resumeJourney() : pauseJourney())) === 'full') setNotice(QUEUE_FULL);
    } catch {
      // Sem sessão aberta a ação não entra na fila e a tela não muda.
    } finally {
      setSubmitting(false);
    }
  };

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
              {liveTask.title}
            </Text>
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
              {liveTask.title}
            </Title>
            <Text variant="body.s" color={theme.content.dark}>
              {liveTask.description}
            </Text>
          </View>
        </View>

        <TaskProgress task={liveTask} theme={theme} />

        {/* Objetivo principal */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Objetivo principal
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            {liveTask.objective}
          </Text>
        </View>

        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Fotos da solicitação
          </Title>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const uri = liveTask.images[i];
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
            {`${Math.round(liveTask.estimatedMinutes / 60)}h até a conclusão`}
          </Text>
        </View>

        {/* Interessados */}
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Interessados
          </Title>
          <AvatarGroup
            avatars={responsibleAvatars}
            totalCount={liveTask.responsibleCount}
            maxVisible={5}
            size="m"
            bordered
          />
          <Text variant="body.m" color={theme.content.dark}>
            {`${liveTask.responsibleNames[0] ?? 'Joacir Alves'} e mais ${liveTask.responsibleCount - 1} pessoas estão acompanhando essa tarefa`}
          </Text>
        </View>

        {isActive ? (
          <View style={{ gap: theme.gap.m }}>
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              labelColor={theme.content.light}
              label="Finalizar tarefa"
              elevation="lg"
              // Desabilitado em paused — não pode finalizar enquanto a
              // tarefa está em pausa (user precisa retomar primeiro) — ou
              // enquanto uma mutação anterior ainda está em voo (submitting).
              disabled={isPaused || submitting}
              accessibilityLabel={
                isPaused
                  ? 'Finalizar tarefa (indisponível enquanto pausado)'
                  : 'Finalizar tarefa'
              }
              onPress={finishTask}
            />
            <Button
              variant="outline"
              borderColor={theme.surface.accent}
              labelColor={theme.surface.accent}
              // "Fazer pausa" no ongoing; "Retomar" no paused — mesma posição,
              // mesmo Button, label/handler trocam por state.
              label={isPaused ? 'Retomar' : 'Fazer pausa'}
              accessibilityLabel={isPaused ? 'Retomar tarefa' : 'Fazer pausa'}
              onPress={toggleShift}
            />
            <Button
              variant="ghost"
              labelColor={theme.content.error}
              label="Cancelar tarefa"
              accessibilityLabel="Cancelar tarefa"
              disabled={submitting}
              onPress={cancelCurrentTask}
            />
            {ctaError ? (
              <Text variant="body.s" color={theme.content.error}>
                {ctaError}
              </Text>
            ) : null}
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
            disabled={submitting}
            onPress={startJourney}
          />
        )}
        {notice ? (
          <Toast variant={notice.variant} title={notice.title} onClose={() => setNotice(null)} />
        ) : null}
        {locationOff ? (
          <Toast
            variant="warning"
            title="Localização desligada: sua posição não será enviada durante a jornada."
            onClose={() => setLocationOff(false)}
          />
        ) : null}
      </ScrollView>
    </View>
  );
}
