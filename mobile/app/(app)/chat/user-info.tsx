import { Image as RNImage, Pressable, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
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
import { useChat } from '../../../services/chat/ChatProvider';
import { formatEta } from '../../../services/vitals/formatEta';
import { ageFrom } from '../../../lib/age';
import { simulatedFatigueFor } from '../../../services/vitals/simulatedContactFatigue';

// Rótulos de gênero a partir do CÓDIGO que o backend guarda ('male'/'female'/
// 'other') — mesma convenção do painel.
const GENDER_LABEL: Record<string, { text: string; symbol: string }> = {
  male: { text: 'Masculino', symbol: '♂' },
  female: { text: 'Feminino', symbol: '♀' },
  other: { text: 'Outro', symbol: '⚧' },
};

const NAO_INFORMADO = 'Não informado';

export default function ChatUserInfo() {
  const router = useRouter();
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  // Até 2026-07-26 esta tela não recebia parâmetro nenhum: abrir o avatar de
  // QUALQUER contato mostrava a ficha fixa do "Romulo Cardoso", com gênero,
  // idade, tipo sanguíneo e alergias inventados. O /chat/directory já devolvia
  // a identidade real de cada colega — só faltava dizer de quem é a ficha.
  const { userId } = useLocalSearchParams<{ userId?: string }>();
  const { directory } = useChat();
  const contact = directory.find((c) => c.workerId === userId) ?? null;

  const gender = contact?.gender ? GENDER_LABEL[contact.gender] : undefined;
  const age = ageFrom(contact?.birthDate);
  const roleLine = [contact?.role, contact?.sector].filter(Boolean).join('\n');
  // Fadiga é dado de smartband → simulado, mas por PESSOA (era 62% pra todos).
  const fatigue = simulatedFatigueFor(contact?.workerId ?? '');

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
          uri={contact?.avatarUri}
          name={contact?.name}
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
            {contact?.name ?? ''}
          </Title>
          <Text
            variant="body.m"
            color={theme.content.dark}
            style={{ textAlign: 'center' }}
          >
            {roleLine}
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
            uri={contact?.avatarUri}
            name={contact?.name}
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
          value={fatigue.pct}
          trackColor={theme.surface.secondaryLight}
          gradient={[
            theme.surface.success,
            theme.surface.warning,
            theme.surface.error,
          ]}
          accessibilityLabel="Tempo até fadiga"
        />
        <Title variant="title.xs" color={theme.content.dark}>
          {formatEta(fatigue.etaMin)}
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
          <Text variant="label.l" color={theme.content.dark}>
            Gênero
          </Text>
          {gender ? (
            <Text variant="label.l" color={theme.content.dark}>
              {gender.symbol}
            </Text>
          ) : null}
        </View>
        {/* Row 2 — Masculino (own line per Figma 336:8920 width 188) */}
        <Text variant="body.m" color={theme.content.dark}>
          {gender?.text ?? NAO_INFORMADO}
        </Text>
        {/* Row 3 — Idade 26 anos */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text variant="label.l" color={theme.content.dark}>
            Idade
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {age !== null ? `${age} anos` : NAO_INFORMADO}
          </Text>
        </View>
        {/* Row 4 — Tipo sanguíneo 🩸 O+ */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text variant="label.l" color={theme.content.dark}>
            Tipo sanguíneo
          </Text>
          <Icon name="humidity_mid" size={16} color={theme.surface.error} />
          <Text variant="body.m" color={theme.content.dark}>
            {contact?.bloodType ?? NAO_INFORMADO}
          </Text>
        </View>
        {/* Row 5 — Alergias Nenhuma */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Text variant="label.l" color={theme.content.dark}>
            Alergias
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {contact?.allergies?.trim() || NAO_INFORMADO}
          </Text>
        </View>
      </View>
    </View>
  );
}
