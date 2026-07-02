import { ActivityIndicator, View } from 'react-native';
import { Button, Text, Title, useTheme } from '@kavicki/swi-design-system';

// State view da tela de Notificações (loading/empty/error). Espelha
// components/chat/ChatState.tsx: compõe primitivos do DS (Title + Text + Button)
// + o ActivityIndicator do RN (não há spinner no DS). Tokens via useTheme(); bg
// transparente pra deixar o gradiente JourneyTheme da tela aparecer atrás.
type StateKind = 'loading' | 'empty' | 'error';

interface NotificationStateProps {
  kind: StateKind;
  onRetry?: () => void; // obrigatório p/ kind==='error'
}

export function NotificationState({ kind, onRetry }: NotificationStateProps) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: 'transparent',
        gap: theme.gap.l,
        padding: theme.padding.l,
      }}
    >
      {kind === 'loading' ? (
        <ActivityIndicator size="large" color={theme.content.primary} />
      ) : (
        <Title variant="title.s" color={theme.content.dark} style={{ textAlign: 'center' }}>
          {kind === 'empty' ? 'Nenhuma notificação' : 'Não foi possível carregar'}
        </Title>
      )}
      <Text variant="body.m" color={theme.content.dark} style={{ textAlign: 'center' }}>
        {kind === 'loading'
          ? 'Carregando notificações…'
          : kind === 'empty'
            ? 'Você está em dia. Nenhuma notificação por aqui.'
            : 'Houve um problema ao buscar as notificações. Tente novamente.'}
      </Text>
      {kind === 'error' && onRetry && (
        <Button
          variant="contained"
          label="Tentar novamente"
          elevation="lg"
          accessibilityLabel="Tentar carregar as notificações de novo"
          onPress={onRetry}
        />
      )}
    </View>
  );
}
