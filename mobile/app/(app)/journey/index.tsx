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

// Figma 364:16378 — journey planner. "Hoje" header + Avatar + DonutChart
// (8h não iniciadas) + 4 task cards "Próximas tarefas" + Iniciar Jornada
// CTA + 2 FABs (chat + home). Demo phase: tasks são mock (shared via
// lib/journeyMockData), Iniciar → /journey/ongoing, Chat → /chat/inbox,
// Home → /dashboard.

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

export default function Journey() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/journey-bg.png')}
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
              <Text variant="body.s" weight="bold" color={theme.content.dark}>
                27/04/2026
              </Text>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
              <Avatar uri={avatarUri} size="l" bordered borderWidth={4} />
              <View style={{ flex: 1 }}>
                <Text variant="body.m" weight="bold" color={theme.content.dark}>
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
            value="8h"
            label="Não iniciadas"
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

        <Title variant="title.xs" color={theme.content.dark}>
          Próximas tarefas
        </Title>

        {/* Task cards — compose local porque DS HorizontalCard só tem
            label single-line (gap diferido: estender DS com `description`
            quando houver mais consumers desse pattern).
            Figma 364:17112: container do task list é overflow-y-auto.
            Inner ScrollView com flex:1 contém só a lista — header e CTA
            ficam fixos fora dela. */}
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: theme.gap.s }}
          showsVerticalScrollIndicator={false}
        >
          {TASKS.map((task) => (
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
              {/* Radio circle — Figma 364:17045 usa stroke #8AD2E2 (light teal),
                  não white. Cor extraída do imgRadio asset SVG. */}
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

        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Iniciar Jornada"
          elevation="lg"
          accessibilityLabel="Iniciar Jornada"
          onPress={() => router.push('/(app)/journey/ongoing')}
        />
      </View>

      <NavFABs />
    </View>
  );
}
