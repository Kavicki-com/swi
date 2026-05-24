import { memo, useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import * as ImagePicker from 'expo-image-picker';
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

import { FALLBACK_TASK, findTaskById } from '../../../../lib/journeyMockData';

// Figma 364:17126 (idle) / 364:17434 (in-progress). Breadcrumb
// (Jornada > <task>) + task summary card + ProgressBar + Objetivo +
// Fotos + Tempo estimado + Interessados + CTA. Aceita tanto
// `?state=ongoing` (uso interno via router.push) quanto
// `?state=in-progress` (deep-link externo / spec do Figma) para
// flip pra variante phase-2.
// Demo phase: tasks são mock compartilhados via lib/journeyMockData
// e resolvidos por findTaskById(id) com FALLBACK_TASK pra ids inválidos.

// 5 distinct demo avatars from /assets/avatars/worker-{1..5}.png.
// Asset.fromModule resolves each require() to a Metro-served URI string
// so DS Avatar (which only accepts `uri: string`) can render them. Matches
// Figma's varied photo thumbnails for the Interested cluster.
const INTERESTED_AVATARS = [
  { uri: Asset.fromModule(require('../../../../assets/avatars/worker-1.png')).uri, alt: 'Avatar 1' },
  { uri: Asset.fromModule(require('../../../../assets/avatars/worker-2.png')).uri, alt: 'Avatar 2' },
  { uri: Asset.fromModule(require('../../../../assets/avatars/worker-3.png')).uri, alt: 'Avatar 3' },
  { uri: Asset.fromModule(require('../../../../assets/avatars/worker-4.png')).uri, alt: 'Avatar 4' },
  { uri: Asset.fromModule(require('../../../../assets/avatars/worker-5.png')).uri, alt: 'Avatar 5' },
];

// Crawl rate: progresso aumenta 1pt por segundo enquanto a task está ongoing.
// Demo phase: simulação visual; produção tracking real seria via backend timer
// (estimated 3h = 10800s = ~0.009pt/s pra completar em 3h reais — mas pro
// demo queremos progress visível na ordem de minutos, então 1pt/s).
const PROGRESS_CRAWL_INTERVAL_MS = 1000;
const PROGRESS_CRAWL_STEP = 1;

// T4.1: Sub-componente memoizado que owns o `progress` state + interval.
// Antes, o setInterval rodava no TaskDetails e re-renderizava a tela inteira
// (8 sub-sections, ScrollView, Texts/Titles) por segundo. Agora só este
// componente re-renderiza 1×/s.
type TaskState = 'idle' | 'ongoing' | 'paused';
type TaskProgressProps = {
  taskState: TaskState;
  theme: ReturnType<typeof useTheme>;
};
const TaskProgress = memo(function TaskProgress({ taskState, theme }: TaskProgressProps) {
  const [progress, setProgress] = useState(taskState === 'idle' ? 2 : 30);

  useEffect(() => {
    if (taskState === 'idle') setProgress(2);
  }, [taskState]);

  useEffect(() => {
    if (taskState !== 'ongoing') return;
    const interval = setInterval(() => {
      setProgress((p) => Math.min(100, p + PROGRESS_CRAWL_STEP));
    }, PROGRESS_CRAWL_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [taskState]);

  return (
    <View style={{ gap: theme.gap.m }}>
      <Title variant="title.xs" color={theme.content.dark}>
        Progresso da tarefa
      </Title>
      <ProgressBar
        value={progress}
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
  const task = findTaskById(id) ?? FALLBACK_TASK;

  // Source of truth: JourneyProvider (shared state cross-screen). Esta task
  // só está "ativa" se ela é a activeTaskId do journey; senão renderiza idle
  // mesmo que outra task esteja ongoing em paralelo.
  const {
    state: journeyState,
    activeTaskId,
    startTask,
    pauseJourney,
    resumeJourney,
    endJourney,
  } = useJourney();
  const isActiveTask = activeTaskId === id;
  const taskState: TaskState = isActiveTask ? journeyState : 'idle';

  const isPaused = taskState === 'paused';
  const isActive = taskState !== 'idle';

  const finishOrCancel = () => {
    endJourney();
    router.push('/(app)/journey');
  };

  // Fotos da solicitação — local state (demo phase, sem persistência).
  // photos[i] = uri | undefined. Placeholder vazio se undefined.
  const [photos, setPhotos] = useState<(string | undefined)[]>(
    [undefined, undefined, undefined, undefined, undefined],
  );

  const setPhotoAt = (index: number, uri: string) => {
    setPhotos((prev) => {
      const next = [...prev];
      next[index] = uri;
      return next;
    });
  };

  const pickFromGallery = async (index: number) => {
    const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Precisamos de acesso à galeria.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoAt(index, result.assets[0].uri);
    }
  };

  const takePhoto = async (index: number) => {
    const { status } = await ImagePicker.requestCameraPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permissão negada', 'Precisamos de acesso à câmera.');
      return;
    }
    const result = await ImagePicker.launchCameraAsync({
      allowsEditing: true,
      quality: 0.8,
    });
    if (!result.canceled && result.assets[0]) {
      setPhotoAt(index, result.assets[0].uri);
    }
  };

  const showPicker = (index: number) => {
    Alert.alert(
      'Adicionar foto',
      undefined,
      [
        { text: 'Tirar foto', onPress: () => takePhoto(index) },
        { text: 'Escolher da galeria', onPress: () => pickFromGallery(index) },
        { text: 'Cancelar', style: 'cancel' },
      ],
    );
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
        <TaskProgress taskState={taskState} theme={theme} />

        {/* Objetivo principal */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Objetivo principal
          </Title>
          <Text variant="body.m" color={theme.content.dark}>
            Garantir a segurança operacional e prolongar a vida útil dos equipamentos,
            minimizando paradas não planejadas e otimizando a eficiência da produção.
          </Text>
        </View>

        {/* Fotos da solicitação — 5 placeholders 56×56 com add_a_photo
            glifo centrado (Figma 364:17126 mostra ícone de câmera/foto
            em cada placeholder cinza). */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Fotos da solicitação
          </Title>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[0, 1, 2, 3, 4].map((i) => {
              const uri = photos[i];
              return (
                <Pressable
                  key={i}
                  onPress={() => showPicker(i)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    uri
                      ? `Foto ${i + 1} (toque para substituir)`
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
            3h até a conclusão
          </Text>
        </View>

        {/* Interessados */}
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Interessados
          </Title>
          <AvatarGroup
            avatars={INTERESTED_AVATARS}
            totalCount={18}
            maxVisible={5}
            size="m"
            bordered
          />
          <Text variant="body.m" color={theme.content.dark}>
            Joacir Alves e mais 17 pessoas estão acompanhando essa tarefa
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
