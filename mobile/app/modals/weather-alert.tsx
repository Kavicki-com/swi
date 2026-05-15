import { Pressable, Text as RNText, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import {
  Button,
  Icon,
  Title,
  WeatherIcon,
  useTheme,
} from '@kavicki/swi-design-system';

// Figma 385:29371 — alert-modal (weather alert). Centered modal compact
// (~280×400). Title + row (weather-condition card + weather-data
// metrics) + body text + Instruções de segurança CTA red.
// Demo phase: weather data hardcoded; CTA → /evacuation (Phase 2).

export default function WeatherAlertModal() {
  const theme = useTheme();
  const router = useRouter();
  const close = () => router.back();

  return (
    <>
      <Stack.Screen
        options={{
          presentation: 'transparentModal',
          animation: 'fade',
        }}
      />

      <View
        style={{
          flex: 1,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: 'rgba(0,0,0,0.5)',
          padding: theme.padding.m,
        }}
      >
        <Pressable
          onPress={close}
          accessibilityLabel="Fechar"
          accessibilityRole="button"
          style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
        />

        <View
          style={{
            width: '100%',
            maxWidth: 320,
            backgroundColor: theme.surface.standard,
            paddingVertical: theme.padding.m,
            paddingHorizontal: theme.padding.sm,
            borderRadius: theme.border.radius.m,
            gap: theme.gap.m,
            alignItems: 'center',
          }}
        >
          <Title variant="title.xs" color={theme.content.dark}>
            Local em Alerta!
          </Title>

          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              width: '100%',
              gap: theme.gap.m,
            }}
          >
            <View
              style={{
                width: 111,
                height: 100,
                backgroundColor: theme.surface.high,
                borderRadius: theme.border.radius.m,
                paddingHorizontal: theme.padding.s,
                paddingBottom: theme.padding.s,
                alignItems: 'center',
                justifyContent: 'flex-end',
                gap: theme.gap.xs,
                position: 'relative',
              }}
            >
              <View
                style={{
                  position: 'absolute',
                  top: -28,
                  alignSelf: 'center',
                }}
              >
                <WeatherIcon condition="rainy" size="m" />
              </View>
              <RNText
                style={{
                  fontFamily: theme.fontFamily.title,
                  fontWeight: theme.fontWeight.bold,
                  fontSize: 32,
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
                  textAlign: 'center',
                }}
              >
                Chuva Intensa
              </RNText>
            </View>

            <View style={{ gap: theme.gap.s, flex: 1 }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Icon name="humidity_mid" size={24} color={theme.content.dark} />
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.regular,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  65%
                </RNText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name="keyboard_arrow_right" size={20} color={theme.content.dark} />
                </View>
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.regular,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  65km/h
                </RNText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Icon name="keyboard_arrow_up" size={24} color={theme.surface.warning} />
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.regular,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  32ºC
                </RNText>
              </View>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
                <Icon name="keyboard_arrow_down" size={24} color={theme.content.secondary} />
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.regular,
                    fontSize: theme.fontSize.m,
                    color: theme.content.dark,
                  }}
                >
                  19ºC
                </RNText>
              </View>
            </View>
          </View>

          <RNText
            style={{
              fontFamily: theme.fontFamily.body,
              fontWeight: theme.fontWeight.regular,
              fontSize: theme.fontSize.m,
              color: theme.content.dark,
              textAlign: 'center',
            }}
          >
            Risco de desabamentos nas primeiras horas do dia, procure a rota de siga as instruções para a evacuação.
          </RNText>

          <Button
            variant="contained"
            backgroundColor={theme.surface.error}
            labelColor={theme.content.light}
            label="Instruções de segurança"
            elevation="lg"
            accessibilityLabel="Instruções de segurança"
            onPress={() => router.push('/(app)/evacuation')}
          />
        </View>
      </View>
    </>
  );
}
