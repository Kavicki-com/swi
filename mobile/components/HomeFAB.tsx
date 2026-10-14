import { Button, Icon, useTheme } from '@kavicki/swi-design-system';

// Home FAB redondo (desenho do Figma): círculo de 71,4286px, miolo claro
// (content.dark), anel escuro de 10,2857px (content.disable) e ícone home preto
// (content.light). Composição sobre o Button do DS (shape "pill" + `diameter`,
// que documenta e dimensiona exatamente este FAB), sem SVG local. Usado pelo
// NavFABs e pelas telas de settings.
//
// A borda desenha por dentro (RN é border-box), então o anel grosso forma o
// contorno sem estourar o círculo, e sem o halo branco que o antigo sanduíche
// de dois círculos SVG deixava.
const DIAMETER = 71.4286;
const RING = 10.2857;
// Arte natural do ícone home no DS (~28,286 x 25,458), proporcional para não
// achatar na vertical.
const ICON_WIDTH = 28.286;
const ICON_HEIGHT = 25.458;

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
  const theme = useTheme();
  return (
    <Button
      variant="contained"
      shape="pill"
      diameter={DIAMETER}
      backgroundColor={theme.content.dark}
      borderColor={theme.content.disable}
      borderWidth={RING}
      elevation="md"
      iconLeft={
        <Icon name="home" width={ICON_WIDTH} height={ICON_HEIGHT} color={theme.content.light} />
      }
      accessibilityLabel={accessibilityLabel}
      testID={testID}
      onPress={onPress}
    />
  );
}
