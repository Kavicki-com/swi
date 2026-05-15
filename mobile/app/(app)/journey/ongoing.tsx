import { Image as RNImage, Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Avatar,
  Button,
  DonutChart,
  Icon,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 364:17609 — journey-ongoing. Variação de /journey com DonutChart
// "Em andamento" + nova section "Em andamento" mostrando task ativa +
// "Próximas tarefas" só com os 3 restantes + CTAs Finalizar/Pausa.
// Demo phase: active task hardcoded como 'inspecao'; outros tasks
// permanecem na fila pra navegar pra /journey/task/[id].

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

const ACTIVE_TASK = {
  id: 'inspecao',
  title: 'Inspeção de Equipamentos',
  description:
    'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
};

const UPCOMING_TASKS = [
  {
    id: 'manutencao',
    title: 'Manutenção Preventiva',
    description:
      'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
  },
  {
    id: 'diagnostico',
    title: 'Diagnóstico de Falhas',
    description:
      'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
  },
  {
    id: 'reparo',
    title: 'Reparo de Componentes',
    description:
      'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
  },
];

export default function JourneyOngoing() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/journey-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Header: Hoje + date + avatar | DonutChart em andamento */}
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <View style={{ flex: 1, gap: theme.gap.m }}>
            <View style={{ gap: theme.gap.xs }}>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.title,
                  fontWeight: theme.fontWeight.bold,
                  fontSize: 32,
                  color: theme.content.dark,
                }}
              >
                Hoje
              </RNText>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: theme.fontWeight.bold,
                  fontSize: theme.fontSize.sm,
                  color: theme.content.dark,
                }}
              >
                27/04/2026
              </RNText>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
              <Avatar uri={avatarUri} size="l" bordered borderWidth={4} />
              <View style={{ flex: 1 }}>
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.bold,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  Romulo Cardoso
                </RNText>
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.regular,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  Mecânico maquinário B2
                </RNText>
              </View>
            </View>
          </View>

          <DonutChart
            title=""
            value="7:55:12h"
            label="Em andamento"
            progress={0.07}
            icon="av_timer"
            iconColor={theme.content.dark}
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
              <View
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 5,
                  backgroundColor: theme.content.primary,
                }}
              />
            </View>

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
                {ACTIVE_TASK.title}
              </RNText>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: theme.fontWeight.medium,
                  fontSize: theme.fontSize.sm,
                  color: theme.content.dark,
                }}
              >
                {ACTIVE_TASK.description}
              </RNText>
            </View>
          </Pressable>
        </View>

        {/* Próximas tarefas — 3 restantes */}
        <View style={{ gap: theme.gap.m }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Próximas tarefas
          </Title>
          <View style={{ gap: theme.gap.s }}>
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
                    borderColor: theme.content.dark,
                  }}
                />

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

                <Icon name="add" size={24} color={theme.content.dark} />
              </Pressable>
            ))}
          </View>
        </View>

        {/* CTAs */}
        <View style={{ gap: theme.gap.m }}>
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Finalizar Jornada"
            elevation="lg"
            accessibilityLabel="Finalizar Jornada"
            onPress={() => router.push('/(app)/journey')}
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
      </ScrollView>

      {/* Chat FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          right: theme.padding.m,
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.surface.success}
          elevation="lg"
          iconLeft={
            <Icon
              name="chat_bubble"
              width={25.714}
              height={25.714}
              color={theme.content.light}
            />
          }
          accessibilityLabel="Abrir chat"
          onPress={() => router.push('/(app)/chat/inbox')}
        />
      </View>

      {/* Home FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
