import { Image as RNImage, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  AvatarGroup,
  Button,
  Icon,
  ProgressBar,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 364:17126 — task details. Breadcrumb (Jornada > <task>) +
// task summary card + ProgressBar + Objetivo + Fotos + Tempo estimado
// + Interessados + CTA "Iniciar Jornada e começar tarefa".
// Demo phase: tasks são mock keyed by [id] route param.

type TaskData = {
  title: string;
  description: string;
};

const TASKS: Record<string, TaskData> = {
  inspecao: {
    title: 'Inspeção de Equipamentos',
    description:
      'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
  },
  manutencao: {
    title: 'Manutenção Preventiva',
    description:
      'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
  },
  diagnostico: {
    title: 'Diagnóstico de Falhas',
    description:
      'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
  },
  reparo: {
    title: 'Reparo de Componentes',
    description:
      'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
  },
};

const FALLBACK: TaskData = TASKS.inspecao;

const INTERESTED_AVATARS = [
  { uri: undefined, alt: 'Avatar 1' },
  { uri: undefined, alt: 'Avatar 2' },
  { uri: undefined, alt: 'Avatar 3' },
  { uri: undefined, alt: 'Avatar 4' },
  { uri: undefined, alt: 'Avatar 5' },
];

export default function TaskDetails() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id: string }>();
  const task = (id && TASKS[id]) || FALLBACK;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../../assets/journey-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

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
            <RNText
              style={{
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.m,
                color: theme.content.primary,
              }}
            >
              Jornada
            </RNText>
            <Icon name="keyboard_arrow_right" size={24} color={theme.content.primary} />
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
            <RNText
              style={{
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.m,
                color: theme.content.primary,
                flexShrink: 1,
              }}
            >
              {task.title}
            </RNText>
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
            <RNText
              style={{
                fontFamily: theme.fontFamily.title,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.ms,
                color: theme.content.dark,
              }}
              numberOfLines={1}
            >
              {task.title}
            </RNText>
            <RNText
              style={{
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.medium,
                fontSize: theme.fontSize.sm,
                color: theme.content.dark,
              }}
            >
              {task.description}
            </RNText>
          </View>
        </View>

        {/* Progresso da tarefa */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Progresso da tarefa
          </Title>
          <ProgressBar value={0.02} color={theme.content.primary} />
        </View>

        {/* Objetivo principal */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Objetivo principal
          </Title>
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.dark,
            }}
          >
            Garantir a segurança operacional e prolongar a vida útil dos equipamentos,
            minimizando paradas não planejadas e otimizando a eficiência da produção.
          </RNText>
        </View>

        {/* Fotos da solicitação — 5 placeholders 56×56 */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Fotos da solicitação
          </Title>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            {[1, 2, 3, 4, 5].map((i) => (
              <View
                key={i}
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: theme.surface.medium,
                  borderRadius: theme.border.radius.s,
                }}
              />
            ))}
          </View>
        </View>

        {/* Tempo estimado */}
        <View style={{ gap: theme.gap.s }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Tempo estimado
          </Title>
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.dark,
            }}
          >
            3h até a conclusão
          </RNText>
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
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.dark,
            }}
          >
            Joacir Alves e mais 17 pessoas estão acompanhando essa tarefa
          </RNText>
        </View>

        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Iniciar Jornada e começar tarefa"
          elevation="lg"
          accessibilityLabel="Iniciar Jornada e começar tarefa"
          onPress={() => router.push('/(app)/journey/ongoing')}
        />
      </ScrollView>
    </View>
  );
}
