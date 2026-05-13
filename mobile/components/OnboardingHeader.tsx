// Page-level compose used by all 3 complimentary-data steps. Mirrors the
// `Header > Greeting + Description` group in Figma (211:13011, 213:13394,
// 213:13468). Renders the "Boas vindas %username%!" greeting (mixed 20px +
// 32px Bold) and the secondary description line.
import { View } from 'react-native';
import { Text, useTheme } from '@kavicki/swi-design-system';

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
      <Text
        style={{
          fontFamily: theme.fontFamily.title,
          fontWeight: theme.fontWeight.bold,
          color: theme.content.dark,
        }}
      >
        <Text
          style={{
            fontFamily: theme.fontFamily.title,
            fontWeight: theme.fontWeight.bold,
            fontSize: 20,
            color: theme.content.dark,
          }}
        >
          Boas vindas
        </Text>
        <Text
          style={{
            fontFamily: theme.fontFamily.title,
            fontWeight: theme.fontWeight.bold,
            fontSize: 32,
            color: theme.content.dark,
          }}
        >
          {` ${username}!`}
        </Text>
      </Text>
      <Text variant="body.m">{description}</Text>
    </View>
  );
}
