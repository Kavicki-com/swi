import { Image as RNImage, Pressable, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';
import {
  Avatar,
  Button,
  Icon,
  ProgressBar,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system';

// Local avatar (Romulo) — mock contact whose profile is shown.
const avatarUri = Asset.fromModule(
  require('../../../assets/avatars/worker-1.png'),
).uri;

export default function ChatUserInfo() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + theme.padding.m,
        paddingHorizontal: theme.padding.m,
        gap: theme.gap.sm,
      }}
    >
      {/* Close button — Figma 337:9155 (top-left X) */}
      <Pressable
        onPress={() => router.back()}
        accessibilityRole="button"
        accessibilityLabel="Fechar"
        style={{ paddingVertical: theme.padding.sm }}
      >
        <Icon name="close" size={24} color={theme.content.dark} />
      </Pressable>

      {/* User card — Avatar + Name + Role (Figma 336:8893) */}
      <View style={{ gap: theme.padding.m, alignItems: 'center', width: '100%' }}>
        <Avatar
          customSize={56}
          uri={avatarUri}
          bordered
          borderWidth={4}
          borderColor={theme.content.primary}
        />
        <View style={{ gap: theme.padding.xs, width: '100%' }}>
          <Title
            variant="title.xs"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            Romulo Cardoso
          </Title>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            Operador de escavadeira{'\n'}Maquinário pesado
          </Text>
        </View>
      </View>

      {/* Mini-map — Figma 336:8898. Increased to 140px tall to fit the "Ver mapa
          completo" button cleanly (Figma 124px clipped it). */}
      <View
        style={{
          height: 140,
          width: '100%',
          borderRadius: theme.border.radius.m,
          overflow: 'hidden',
          backgroundColor: theme.surface.medium,
        }}
      >
        {/* Basemap — real Figma asset (336:8899) saved at mobile/assets/basemap.png */}
        <RNImage
          source={require('../../../assets/basemap.png')}
          resizeMode="cover"
          style={{ width: '100%', height: '100%' }}
        />

        {/* Location pin: avatar 24 + triangle 9×8 (total 32 tall) centered
            vertically. Avatar top at marginTop:-16, triangle top at marginTop:8. */}
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginLeft: -12,
            marginTop: -16,
          }}
        >
          <Avatar
            customSize={24}
            uri={avatarUri}
            bordered
            borderWidth={2}
            borderColor={theme.content.secondaryLight}
          />
        </View>
        <View
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            marginLeft: -4.5,
            marginTop: 8,
          }}
        >
          <Svg width={9} height={8} viewBox="0 0 9 8">
            <Path d="M0 0 L9 0 L4.5 8 Z" fill={theme.content.secondaryLight} />
          </Svg>
        </View>

        {/* Camera button — top-right (size custom ~38x38) */}
        <View style={{ position: 'absolute', top: 12, right: 12 }}>
          <Button
            variant="contained"
            size="small"
            backgroundColor={theme.surface.high}
            elevation="lg"
            iconLeft={
              <Icon
                name="video_camera_back"
                width={20}
                height={16}
                color={theme.content.dark}
              />
            }
            accessibilityLabel="Ver câmera"
            onPress={() => {}}
          />
        </View>

        {/* "Ver mapa completo" — bottom-left (Figma 337:9186). variant=surface gives
            content.dark label (white) on surface.standard bg automatically. */}
        <View style={{ position: 'absolute', bottom: 8, left: 8 }}>
          <Button
            variant="surface"
            size="small"
            elevation="lg"
            label="Ver mapa completo"
            accessibilityLabel="Ver mapa completo"
            onPress={() => router.push('/(app)/map')}
          />
        </View>
      </View>

      {/* Fadigue bar — Figma 336:8912 */}
      <View style={{ gap: theme.gap.m, width: '100%' }}>
        <Title variant="title.xs" color={theme.content.dark}>
          Tempo até a fadiga total
        </Title>
        {/* Figma 336:8912 — track has pr-125 on a ~328 container, so the
            gradient fill covers ~62% (success → warning at 54.327% → error).
            DS ProgressBar auto-distributes stops evenly across the array,
            close enough to Figma at this width. */}
        <ProgressBar
          value={62}
          trackColor={theme.surface.secondaryLight}
          gradient={[
            theme.surface.success,
            theme.surface.warning,
            theme.surface.error,
          ]}
          accessibilityLabel="Tempo até fadiga"
        />
        <Title variant="title.xs" color={theme.content.dark}>
          1:45:12 h
        </Title>
      </View>

      {/* Complementary data card — Figma 336:8916. 5 rows matching the wrapped
          layout (where `Masculino` has width 188 forcing wrap to its own line).
          Bold labels use Inter Bold 16; values use body.m (14). */}
      <View
        style={{
          width: '100%',
          backgroundColor: theme.surface.standard,
          borderRadius: theme.border.radius.l,
          padding: theme.padding.l,
          gap: theme.gap.s,
        }}
      >
        {/* Row 1 — Gênero ♂ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text
            variant="subtitle.m"
            color={theme.content.dark}
            style={{ fontWeight: '700' }}
          >
            Gênero
          </Text>
          <Text
            variant="subtitle.m"
            color={theme.content.dark}
            style={{ fontWeight: '700' }}
          >
            ♂
          </Text>
        </View>
        {/* Row 2 — Masculino (own line per Figma 336:8920 width 188) */}
        <Text variant="body.m" color={theme.content.dark}>
          Masculino
        </Text>
        {/* Row 3 — Idade 26 anos */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text
            variant="subtitle.m"
            color={theme.content.dark}
            style={{ fontWeight: '700' }}
          >
            Idade
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            26 anos
          </Text>
        </View>
        {/* Row 4 — Tipo sanguíneo 🩸 O+ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text
            variant="subtitle.m"
            color={theme.content.dark}
            style={{ fontWeight: '700' }}
          >
            Tipo sanguíneo
          </Text>
          <Icon name="humidity_mid" size={16} color={theme.surface.error} />
          <Text variant="body.m" color={theme.content.dark}>
            O+
          </Text>
        </View>
        {/* Row 5 — Alergias Nenhuma */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text
            variant="subtitle.m"
            color={theme.content.dark}
            style={{ fontWeight: '700' }}
          >
            Alergias
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            Nenhuma
          </Text>
        </View>
      </View>
    </View>
  );
}
