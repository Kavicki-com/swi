// Page-level compose used by all 3 complimentary-data steps. Mirrors the
// `Header > Greeting + Description` group em Figma (211:13011, 213:13394,
// 213:13468). Renders greeting "Boas vindas" (title.s 20px) na 1ª linha,
// username (title.l 32px Bold) na 2ª linha + description abaixo. Duas
// Title separadas em vez de spans nested garantem o break independente
// do comprimento do username — sem isso, "joão" cabia inline e quebrava
// o ritmo vertical do form em relação ao Figma.
import { View } from 'react-native';
import { Text, Title, useTheme } from '@kavicki/swi-design-system';

export interface OnboardingHeaderProps {
  username?: string;
  description?: string;
}

export function OnboardingHeader({
  username = 'usuário',
  description = 'Vamos dar continuidade ao seu cadastro',
}: OnboardingHeaderProps) {
  const theme = useTheme();
  return (
    <View style={{ gap: theme.gap.s, alignSelf: 'stretch' }}>
      {/* Greeting block: 2 linhas sem gap entre si — natural line-height
          replicates Figma's `<p>` with inline span break. */}
      <View>
        <Title variant="title.s" color={theme.content.dark}>
          Boas vindas
        </Title>
        <Title variant="title.l" color={theme.content.dark}>
          {username}!
        </Title>
      </View>
      <Text variant="body.m">{description}</Text>
    </View>
  );
}
