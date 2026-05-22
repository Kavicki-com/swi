import { Pressable } from 'react-native';
import Svg, { Circle, ClipPath, Defs, G, Path, Rect } from 'react-native-svg';

// Home FAB — fiel ao Figma 348:10334 (ContainedButton/home).
//
// Arquitetura limpa:
// - Pressable: background `#303030` (cor do anel) + borderRadius circular.
//   Atua como o anel externo. Qualquer bleed de anti-aliasing nas bordas
//   do SVG só revela mais `#303030` (mesma cor), não uma faixa branca.
// - SVG dentro do Pressable: apenas o miolo branco (r=25.43, dá anel
//   resultante de 10.286pt) + ícone home.
//
// Antes: o Pressable tinha bg `#F5F5F5` (branco), o SVG desenhava DOIS
// círculos (dark r=35.71 + white r=25.43). Sub-pixel rendering deixava uma
// fina linha branca contornando o anel ("borda cortada" reportada pelo
// usuário). Movendo o dark pro Pressable bg, eliminamos o sandwich.
//
// Cores hardcoded conforme variable defs do Figma:
//   #F5F5F5 = content/dark (miolo branco)
//   #303030 = content/disable (anel cinza escuro)
//   #222222 = content/light (ícone home preto)
//
// Sombra: shadow* (iOS) + elevation (Android). Drop-shadow Figma:
// offset (0, 4), blur 8, rgba(29,29,29,0.16).

const CIRCLE_DIAMETER = 71.4286;
const CIRCLE_RADIUS = CIRCLE_DIAMETER / 2; // 35.7143
const RING_INNER_RADIUS = CIRCLE_RADIUS - 10.2857; // 25.4286 → anel 10.286pt

export interface HomeFABProps {
  onPress: () => void;
  accessibilityLabel?: string;
  testID?: string;
}

export function HomeFAB({
  onPress,
  accessibilityLabel = 'Voltar para a dashboard',
  testID,
}: HomeFABProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      hitSlop={8}
      style={({ pressed }) => ({
        width: CIRCLE_DIAMETER,
        height: CIRCLE_DIAMETER,
        borderRadius: CIRCLE_RADIUS,
        // bg = cor do anel. Elimina o "halo" branco que aparecia quando
        // o bg era #F5F5F5 e o SVG desenhava o dark por cima — sub-pixel
        // rendering deixava uma fina linha branca contornando o botão.
        backgroundColor: '#303030',
        alignItems: 'center',
        justifyContent: 'center',
        opacity: pressed ? 0.9 : 1,
        // Drop-shadow Figma 348:10334 (offset 0/4, blur 8, #1D1D1D 16%).
        shadowColor: '#1D1D1D',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.16,
        shadowRadius: 8,
        elevation: 6,
      })}
    >
      <Svg
        width={CIRCLE_DIAMETER}
        height={CIRCLE_DIAMETER}
        viewBox="0 0 71.4286 71.4286"
        fill="none"
      >
        <Defs>
          <ClipPath id="homeFabIconClip">
            <Rect
              x="21.5714"
              y="22.9853"
              width="28.2857"
              height="25.4579"
              fill="white"
            />
          </ClipPath>
        </Defs>

        {/* Miolo branco (#F5F5F5 content/dark). O anel dark vem do bg do
            Pressable; aqui só precisamos pintar o centro. Anel resultante:
            (CIRCLE_RADIUS 35.71 - RING_INNER_RADIUS 25.43) = 10.286pt. */}
        <Circle
          cx={CIRCLE_RADIUS}
          cy={CIRCLE_RADIUS}
          r={RING_INNER_RADIUS}
          fill="#F5F5F5"
        />
        {/* Ícone home (content/light = #222222). Path original 348:10334
            transladado: subtraído 20.57 em x e 15.43 em y. */}
        <G clipPath="url(#homeFabIconClip)">
          <Path
            d="M35.7143 22.9853C35.7143 22.9853 26.965 30.5381 22.0761 34.6282C21.9206 34.7637 21.7954 34.9303 21.7085 35.1173C21.6216 35.3043 21.5749 35.5074 21.5714 35.7136C21.5714 36.0901 21.721 36.4513 21.9872 36.7175C22.2535 36.9837 22.6146 37.1333 22.9911 37.1333H25.8138V47.0338C25.8138 47.4104 25.9633 47.7715 26.2296 48.0377C26.4958 48.304 26.8569 48.4535 27.2335 48.4535H31.4719C31.8485 48.4535 32.2096 48.304 32.4758 48.0377C32.7421 47.7715 32.8916 47.4104 32.8916 47.0338V41.3718H38.5434V47.0287C38.5434 47.4052 38.6929 47.7663 38.9592 48.0326C39.2254 48.2988 39.5865 48.4484 39.9631 48.4484H44.2054C44.5819 48.4484 44.9431 48.2988 45.2093 48.0326C45.4755 47.7663 45.6251 47.4052 45.6251 47.0287V37.1282H48.4426C48.8191 37.1282 49.1802 36.9786 49.4465 36.7123C49.7127 36.4461 49.8623 36.085 49.8623 35.7085C49.8603 35.4981 49.8105 35.2909 49.7166 35.1026C49.6227 34.9143 49.4871 34.7498 49.3202 34.6217C44.461 30.5381 35.7143 22.9853 35.7143 22.9853Z"
            fill="#222222"
          />
        </G>
      </Svg>
    </Pressable>
  );
}
