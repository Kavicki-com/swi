import { ScrollView, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  Title,
  WeatherIcon,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:29591 — dashboard-alert-active (instructions variant). Reached
// from the dashboard help-button when an alert is active. Weather card +
// 4 numbered evacuation steps + confirmation CTA + Chat/Home FABs.
// Gaps deferidos pra DS v0.1.7: `wind-speed` (linha de vento omite ícone)
// e setas triangulares de temperatura (usado `keyboard_arrow_up/down`).

export default function AlertInstructions() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  const stepCircle = (
    <View
      style={{
        width: 20,
        height: 20,
        borderRadius: 10,
        backgroundColor: theme.surface.primary,
        marginTop: 2,
      }}
    />
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.m,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Title */}
        <View style={{ alignItems: 'center' }}>
          <Title variant="title.xs" color={theme.content.dark}>
            Procedimento de evacuação
          </Title>
        </View>

        {/* Weather row */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.gap.m,
          }}
        >
          {/* Left: condition card */}
          <View
            style={{
              flex: 1,
              backgroundColor: theme.surface.high,
              borderRadius: theme.border.radius.m,
              paddingHorizontal: theme.padding.s,
              paddingTop: theme.padding.l,
              paddingBottom: theme.padding.s,
              alignItems: 'center',
              gap: theme.gap.s,
              minHeight: 100,
            }}
          >
            <View style={{ position: 'absolute', top: -28, alignSelf: 'center' }}>
              <WeatherIcon condition="rainy" size="m" accessibilityLabel="Chuva intensa" />
            </View>
            <RNText
              style={{
                fontFamily: theme.fontFamily.title,
                fontWeight: theme.fontWeight.bold,
                fontSize: theme.fontSize.xxl,
                color: theme.content.dark,
              }}
            >
              17ºC
            </RNText>
            <RNText
              style={{
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.regular,
                fontSize: theme.fontSize.m,
                color: theme.content.dark,
              }}
            >
              Chuva Intensa
            </RNText>
          </View>

          {/* Right: data column */}
          <View style={{ width: 95, gap: theme.gap.s }}>
            <WeatherDataRow theme={theme} iconName="humidity_mid" value="65%" />
            {/* TODO(DS v0.1.7 wind-speed): substituir placeholder por ícone real */}
            <WeatherDataRow theme={theme} value="65km/h" placeholderIcon />
            <WeatherDataRow
              theme={theme}
              iconName="keyboard_arrow_up"
              iconColor={theme.surface.warning}
              value="32ºC"
            />
            <WeatherDataRow
              theme={theme}
              iconName="keyboard_arrow_down"
              iconColor={theme.surface.secondary}
              value="19ºC"
            />
          </View>
        </View>

        {/* Description */}
        <RNText
          style={{
            fontFamily: theme.fontFamily.body,
            fontWeight: theme.fontWeight.medium,
            fontSize: theme.fontSize.sm,
            color: theme.content.dark,
            textAlign: 'center',
          }}
        >
          Risco de desabamentos nas primeiras horas do dia, procure a rota de
          siga as instruções para a evacuação.
        </RNText>

        {/* Instructions list */}
        <View style={{ gap: theme.gap.m, position: 'relative' }}>
          {/* Vertical connecting line (left of circles) */}
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              left: 9,
              top: 10,
              bottom: 10,
              width: 1,
              backgroundColor: theme.surface.primary,
            }}
          />

          {/* Step 1 — Traçar rota */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: theme.fontWeight.regular,
                  fontSize: theme.fontSize.m,
                  color: theme.content.dark,
                }}
              >
                Desloque-se para o local de resgate
              </RNText>
              <Button
                variant="contained"
                backgroundColor={theme.surface.primary}
                labelColor={theme.content.light}
                label="Traçar rota"
                iconRight={
                  <Icon
                    name="location_on"
                    width={16}
                    height={20}
                    color={theme.content.light}
                  />
                }
                elevation="lg"
                accessibilityLabel="Traçar rota de evacuação"
                onPress={() => router.push('/(app)/evacuation')}
              />
            </View>
          </View>

          {/* Step 2 — Mantenha-se em abrigo */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <RNText
              style={{
                flex: 1,
                fontFamily: theme.fontFamily.body,
                fontWeight: theme.fontWeight.regular,
                fontSize: theme.fontSize.m,
                color: theme.content.dark,
              }}
            >
              Mantenha se em um abrigo protegido do vento
            </RNText>
          </View>

          {/* Step 3 — Espere pelo veículo + chip */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <View style={{ flex: 1, gap: 8, alignItems: 'flex-start' }}>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: theme.fontWeight.regular,
                  fontSize: theme.fontSize.m,
                  color: theme.content.dark,
                }}
              >
                Espere pelo veículo de resgate
              </RNText>
              <View
                style={{
                  borderWidth: 1,
                  borderColor: theme.content.primary,
                  borderRadius: theme.border.radius.m,
                  paddingHorizontal: theme.padding.sm,
                  paddingVertical: theme.padding.xs,
                }}
              >
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.medium,
                    fontSize: theme.fontSize.sm,
                    color: theme.content.primary,
                  }}
                >
                  Aprox. 7 minutos
                </RNText>
              </View>
            </View>
          </View>

          {/* Step 4 — Reportar acidente */}
          <View style={{ flexDirection: 'row', gap: 19, alignItems: 'flex-start' }}>
            {stepCircle}
            <View style={{ flex: 1, gap: 12, alignItems: 'flex-start' }}>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.body,
                  fontWeight: theme.fontWeight.regular,
                  fontSize: theme.fontSize.m,
                  color: theme.content.dark,
                }}
              >
                Se você ou alguém estiver ferido, reporte imediatamente à central
              </RNText>
              <Button
                variant="contained"
                backgroundColor={theme.surface.warning}
                labelColor={theme.content.light}
                label="Reportar acidente"
                elevation="lg"
                accessibilityLabel="Reportar acidente"
                onPress={() => router.push('/(app)/reports/new')}
              />
            </View>
          </View>
        </View>

        {/* Confirmation block */}
        <View style={{ gap: 15 }}>
          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.dark,
              textAlign: 'center',
            }}
          >
            Mantenha-se calmo. Estamos à caminho.
          </RNText>
          <Button
            variant="contained"
            backgroundColor={theme.surface.primary}
            labelColor={theme.content.light}
            label="Entendi, estou seguindo as instruções"
            fullWidth
            elevation="lg"
            accessibilityLabel="Confirmar instruções recebidas"
            onPress={() => router.push('/(app)/dashboard')}
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

function WeatherDataRow({
  theme,
  iconName,
  iconColor,
  value,
  placeholderIcon,
}: {
  theme: ReturnType<typeof useTheme>;
  iconName?: 'humidity_mid' | 'keyboard_arrow_up' | 'keyboard_arrow_down';
  iconColor?: string;
  value: string;
  placeholderIcon?: boolean;
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.gap.s,
      }}
    >
      {iconName ? (
        <Icon name={iconName} size={24} color={iconColor ?? theme.content.dark} />
      ) : placeholderIcon ? (
        // TODO(DS v0.1.7): substituir por <Icon name="wind_speed" />
        <View style={{ width: 24, height: 24 }} />
      ) : null}
      <RNText
        style={{
          fontFamily: theme.fontFamily.body,
          fontWeight: theme.fontWeight.regular,
          fontSize: theme.fontSize.m,
          color: theme.content.dark,
        }}
      >
        {value}
      </RNText>
    </View>
  );
}
