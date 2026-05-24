import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  DonutChart,
  Icon,
  JourneyTheme,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../../components/NavFABs';
import { TASKS } from '../../../lib/journeyMockData';
import { useJourney } from '../../../services/journey/JourneyProvider';

// Figma 364:16378 (idle) / 364:17609 (ongoing) / 364:17766 (paused).
// Journey planner com 3 layouts conditional via JourneyProvider state:
//   - idle:    DonutChart "8h / Não iniciadas" + 4 task cards
//   - ongoing: DonutChart "7:55:12h / Em andamento" + "Em andamento" task
//              ativa (filled radio) + Próximas (sem a ativa) + CTAs
//              Finalizar/Fazer pausa
//   - paused:  Idem ongoing mas DonutChart label "Pausado" + Finalizar
//              disabled + CTA "Retomar" (substitui "Fazer pausa")
//
// Estado vem do JourneyProvider (services/journey). Quando user starta
// uma task em task/[id], o context flipa pra ongoing — ao voltar pra
// /journey, esta tela renderiza o layout ongoing automaticamente.
//
// Demo phase: tasks são mock. Chat FAB → /chat/inbox, Home FAB → /dashboard.

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

export default function Journey() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const {
    state: journeyState,
    activeTaskId,
    pauseJourney,
    resumeJourney,
    endJourney,
  } = useJourney();

  const isActive = journeyState !== 'idle';
  const isPaused = journeyState === 'paused';
  // T4.3: useMemo evita refazer find/filter a cada re-render. Recomputa
  // só quando activeTaskId muda (raro — só ao iniciar/terminar task).
  const activeTask = useMemo(
    () => (activeTaskId ? TASKS.find((t) => t.id === activeTaskId) : undefined),
    [activeTaskId],
  );
  // Próximas tarefas exclui a ativa (idle: lista completa; ongoing/paused:
  // lista menos a ativa).
  const upcomingTasks = useMemo(
    () => (isActive ? TASKS.filter((t) => t.id !== activeTaskId) : TASKS),
    [isActive, activeTaskId],
  );

  // DonutChart center text: idle conta horas não iniciadas, ongoing/paused
  // mostra tempo da jornada (hardcoded pro demo — produção viria de timer
  // real no backend).
  const donutValue = isActive ? '7:55:12h' : '8h';
  const donutLabel = isPaused
    ? 'Pausado'
    : isActive
    ? 'Em andamento'
    : 'Não iniciadas';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/login-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

      {/* Figma 364:16378: header + section title fixos, lista de chips
          scrollável internamente (overflow-y-auto no container 364:17112),
          CTA "Iniciar Jornada" fixo logo acima das NavFABs. */}
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
      >
        {/* Header: Hoje + date + avatar | DonutChart */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ flex: 1, gap: theme.gap.m }}>
            <View style={{ gap: theme.gap.xs }}>
              <Title variant="title.l" color={theme.content.dark}>
                Hoje
              </Title>
              <Text variant="badge.s" color={theme.content.dark}>
                27/04/2026
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
              <Avatar uri={avatarUri} size="l" />
              <View style={{ flex: 1 }}>
                <Text variant="label.m" color={theme.content.dark}>
                  Romulo Cardoso
                </Text>
                <Text variant="body.m" color={theme.content.dark}>
                  Mecânico maquinário B2
                </Text>
              </View>
            </View>
          </View>

          <DonutChart
            title=""
            value={donutValue}
            label={donutLabel}
            size="small"
            // Ring decorativo full (Figma 364:16900) — anel gradient contínuo
            // (#3899BF → #3EAB2E) cercando os contadores estáticos. Overrides
            // de iconWidth/Height (18×18) e labelSize/Weight (8/bold) replicam
            // o conteúdo central do design: nest_clock 18px + value 20px Bold +
            // caption/xs 8px Bold.
            progress={100}
            progressGradient={['#3899BF', '#3EAB2E']}
            icon="nest_clock"
            iconColor={theme.content.dark}
            iconWidth={18}
            iconHeight={18}
            labelSize={8}
            labelWeight="bold"
          />
        </View>

        {/* Em andamento — só aparece em ongoing/paused, com a active task
            destacada (filled radio teal #8AD2E2 vs unfilled outline nas
            Próximas). Tap segue pra task/[id] mesmo já estando ativa. */}
        {isActive && activeTask ? (
          <View style={{ gap: theme.gap.m }}>
            <Title variant="title.xs" color={theme.content.dark}>
              Em andamento
            </Title>
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/(app)/journey/task/[id]',
                  params: { id: activeTask.id },
                })
              }
              accessibilityRole="button"
              accessibilityLabel={activeTask.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.sm,
                padding: theme.padding.sm,
                backgroundColor: theme.surface.standard,
                borderRadius: theme.border.radius.m,
              }}
            >
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: theme.content.dark,
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {/* Figma filled radio fill #8AD2E2 (teal). */}
                <View
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: 5,
                    backgroundColor: '#8AD2E2',
                  }}
                />
              </View>
              <View style={{ flex: 1, gap: theme.gap.s }}>
                <Title
                  variant="title.xs"
                  color={theme.content.dark}
                  numberOfLines={1}
                >
                  {activeTask.title}
                </Title>
                <Text variant="body.s" color={theme.content.dark}>
                  {activeTask.description}
                </Text>
              </View>
            </Pressable>
          </View>
        ) : null}

        <Title variant="title.xs" color={theme.content.dark}>
          Próximas tarefas
        </Title>

        {/* Task cards — Figma 364:17112 overflow-y-auto. ScrollView interno
            só com a lista de upcoming (exclui a ativa em ongoing/paused). */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: theme.gap.s }}
          showsVerticalScrollIndicator={false}
        >
          {upcomingTasks.map((task) => (
            <Pressable
              key={task.id}
              onPress={() => router.push({ pathname: '/(app)/journey/task/[id]', params: { id: task.id } })}
              accessibilityRole="button"
              accessibilityLabel={task.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.sm,
                padding: theme.padding.sm,
                backgroundColor: theme.surface.standard,
                borderRadius: theme.border.radius.m,
              }}
            >
              {/* Radio circle — Figma 364:17045 stroke #8AD2E2 (teal). */}
              <View
                style={{
                  width: 16,
                  height: 16,
                  borderRadius: 8,
                  borderWidth: 1.5,
                  borderColor: '#8AD2E2',
                }}
              />

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

              <Icon name="add_circle" size={20} color={theme.content.primary} />
            </Pressable>
          ))}
        </ScrollView>

        {/* CTAs ongoing/paused — Figma 364:17609 (ongoing) / 364:17766 (pause).
            Finalizar disabled em pause (precisa retomar primeiro). Fazer
            pausa vira "Retomar" em pause. Finalizar chama endJourney()
            (zera context state + activeTaskId). */}
        {isActive ? (
          <View style={{ gap: theme.gap.m }}>
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              labelColor={theme.content.light}
              label="Finalizar Jornada"
              elevation="lg"
              disabled={isPaused}
              accessibilityLabel={
                isPaused
                  ? 'Finalizar Jornada (indisponível enquanto pausado)'
                  : 'Finalizar Jornada'
              }
              onPress={() => endJourney()}
            />
            <Button
              variant="outline"
              borderColor={theme.surface.accent}
              labelColor={theme.surface.accent}
              label={isPaused ? 'Retomar' : 'Fazer pausa'}
              accessibilityLabel={isPaused ? 'Retomar jornada' : 'Fazer pausa'}
              onPress={() => (isPaused ? resumeJourney() : pauseJourney())}
            />
          </View>
        ) : null}

      </View>

      <NavFABs />
    </View>
  );
}
