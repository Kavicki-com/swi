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
import { ACTIVE_TASK, UPCOMING_TASKS } from '../../../lib/journeyMockData';

// Figma 364:17609 — journey-ongoing. Variação de /journey com DonutChart
// "Em andamento" + nova section "Em andamento" mostrando task ativa +
// "Próximas tarefas" só com os 3 restantes + CTAs Finalizar/Pausa.
// Demo phase: active task hardcoded como 'inspecao' (compartilhado via
// lib/journeyMockData); outros tasks permanecem na fila pra navegar
// pra /journey/task/[id].

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

export default function JourneyOngoing() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/journey-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

      {/* Figma 364:17609 — header + active task + section title fixos;
          inner ScrollView só na lista de "Próximas tarefas" (Figma 364:17678
          tem overflow-y-auto), CTAs fixos no rodapé acima das NavFABs. */}
      <View
        style={{
          flex: 1,
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
      >
        {/* Header: Hoje + date + avatar | DonutChart em andamento */}
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
            value="7:55:12h"
            label="Em andamento"
            // Figma 364:17675 — decorative full ring (gradient blue→green),
            // mesma config do journey planner.
            size="small"
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

        {/* Em andamento — active task com radio filled (verde) */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Em andamento
          </Title>
          <Pressable
            onPress={() =>
              router.push({
                pathname: '/(app)/journey/task/[id]',
                params: { id: ACTIVE_TASK.id, state: 'ongoing' },
              })
            }
            accessibilityRole="button"
            accessibilityLabel={ACTIVE_TASK.title}
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
              {/* Figma filled radio (imgRadio 655a3ee0...) — fill #8AD2E2 (teal),
                  não verde. Cor extraída do SVG asset. */}
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
                {ACTIVE_TASK.title}
              </Title>
              <Text variant="body.s" color={theme.content.dark}>
                {ACTIVE_TASK.description}
              </Text>
            </View>
          </Pressable>
        </View>

        {/* Próximas tarefas — 3 restantes. Figma 364:17678 com overflow-y-auto:
            o container do list é scrollable. Outer Title fixo, ScrollView interno. */}
        <Title variant="title.xs" color={theme.content.dark}>
          Próximas tarefas
        </Title>
        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ gap: theme.gap.s }}
          showsVerticalScrollIndicator={false}
        >
          {UPCOMING_TASKS.map((task) => (
              <Pressable
                key={task.id}
                onPress={() =>
                  router.push({
                    pathname: '/(app)/journey/task/[id]',
                    params: { id: task.id },
                  })
                }
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

        {/* CTAs */}
        <View style={{ gap: theme.gap.m }}>
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Finalizar Jornada"
            elevation="lg"
            accessibilityLabel="Finalizar Jornada"
            onPress={() => router.back()}
          />
          <Button
            variant="outline"
            borderColor={theme.surface.accent}
            labelColor={theme.surface.accent}
            label="Fazer pausa"
            accessibilityLabel="Fazer pausa"
            onPress={() => router.push('/(app)/journey/pause')}
          />
        </View>
      </View>

      <NavFABs />
    </View>
  );
}
