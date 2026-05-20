import { Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
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

export default function TaskDetails() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { id, state } = useLocalSearchParams<{
    id: string;
    state?: 'ongoing' | 'in-progress';
  }>();
  const task = findTaskById(id) ?? FALLBACK_TASK;
  // Aceita ambos: 'ongoing' (interno) e 'in-progress' (spec Figma / deep-link).
  const isOngoing = state === 'ongoing' || state === 'in-progress';
  // Figma 364:17426 — ProgressBar value usa escala 0-100. Idle ~2% (w=2px
  // visível num track ~320px), ongoing ~30%. Antes estávamos passando 0.02 /
  // 0.3 (escala 0-1) que clampava pra 0.02% / 0.3%, fill invisível.
  const progress = isOngoing ? 30 : 2;

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../../assets/journey-bg.png')}
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
            <Text variant="body.m" weight="bold" color={theme.content.primary}>
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
              variant="body.m"
              weight="bold"
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

        {/* Progresso da tarefa */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Progresso da tarefa
          </Title>
          {/* Figma 364:17426 — bordered track (pill, border #303030 = content.medium-ish,
              padding-y 4) com fill 6px green. trackHeight 16 = padding 4*2 + fill 6 + border 1*2. */}
          <ProgressBar
            value={progress}
            color={theme.content.primary}
            bordered
            trackHeight={16}
          />
        </View>

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
            {[1, 2, 3, 4, 5].map((i) => (
              <View
                key={i}
                style={{
                  width: 56,
                  height: 56,
                  backgroundColor: theme.surface.medium,
                  borderRadius: theme.border.radius.s,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Icon name="add_a_photo" size={24} color={theme.content.medium} />
              </View>
            ))}
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

        {/* CTA group — varia por state (Figma 364:17126 idle vs 364:17434 ongoing) */}
        {isOngoing ? (
          <View style={{ gap: theme.gap.m }}>
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              labelColor={theme.content.light}
              label="Finalizar tarefa"
              elevation="lg"
              accessibilityLabel="Finalizar tarefa"
              onPress={() => router.push('/(app)/journey/ongoing')}
            />
            <Button
              variant="outline"
              borderColor={theme.surface.accent}
              labelColor={theme.surface.accent}
              label="Fazer pausa"
              accessibilityLabel="Fazer pausa"
              onPress={() => router.push('/(app)/journey/pause')}
            />
            <Button
              variant="ghost"
              labelColor={theme.content.error}
              label="Cancelar tarefa"
              accessibilityLabel="Cancelar tarefa"
              onPress={() => router.push('/(app)/journey/ongoing')}
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
            onPress={() =>
              router.push({
                pathname: '/(app)/journey/task/[id]',
                params: { id: id ?? 'inspecao', state: 'ongoing' },
              })
            }
          />
        )}
      </ScrollView>
    </View>
  );
}
