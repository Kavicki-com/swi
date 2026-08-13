import { memo } from 'react';
import { View } from 'react-native';
import {
  Button,
  Icon,
  Text,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system';

// Botão do rodapé do dashboard com contador de pendências sobreposto.
// Compõe Button, Icon e Text do design system; não substitui nenhum deles.
export const BadgedButton = memo(function BadgedButton({
  icon,
  badge,
  accessibilityLabel,
  onPress,
  theme,
}: {
  icon: IconName;
  badge?: string;
  accessibilityLabel: string;
  onPress?: () => void;
  theme: ReturnType<typeof useTheme>;
}) {
  // Invólucro 56×56 conforme Figma 304:2683 / 304:2725. O contador fica no
  // canto superior direito do invólucro, sobrepondo o quadrante do botão, e
  // não flutuando fora dele.
  return (
    <View style={{ width: 56, height: 56 }}>
      <Button
        variant="outline"
        size="large"
        shape="pill"
        borderColor={theme.content.dark}
        borderWidth="s"
        iconLeft={<Icon name={icon} size={24} color={theme.content.dark} />}
        accessibilityLabel={accessibilityLabel}
        onPress={onPress ?? (() => {})}
      />
      {badge ? (
        <View
          // pointerEvents="none" (QA Mobile #2): o contador é absoluto sobre o
          // quadrante superior direito do botão de 56×56. Sem isto ele CAPTURA
          // o toque que cai nos seus 24×24 e não faz nada com ele, e o contador
          // é justamente a parte mais chamativa, que o usuário tende a mirar.
          pointerEvents="none"
          style={{
            position: 'absolute',
            top: 0,
            right: 0,
            width: 24,
            height: 24,
            borderRadius: theme.border.radius.pill,
            backgroundColor: theme.surface.error,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <Text variant="caption.s" color={theme.content.light}>
            {badge}
          </Text>
        </View>
      ) : null}
    </View>
  );
});
