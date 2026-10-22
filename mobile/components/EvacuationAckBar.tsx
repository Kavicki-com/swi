import { useCallback, useState } from 'react';
import { View } from 'react-native';
import { useFocusEffect } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, StatusTag, Text, useTheme } from '@kavicki/swi-design-system';
import { getEvacuationBackend } from '@/services/evacuation/getEvacuationBackend';
import type { ActiveEvacuationView } from '@/services/evacuation/types';
import { NAV_FABS_HEIGHT } from './NavFABs';

// das telas de evacuação; só aparece quando existe evacuação ATIVA na org
// (DATA_BACKEND=api). No mock, getActive() → null e a tela fica como sempre.
// Composição page-level de componentes DS (Button/Text) — nada custom.
export function EvacuationAckBar() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const [active, setActive] = useState<ActiveEvacuationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Consulta a cada foco, não só na montagem: a tela fica na pilha, e quem
  // volta pra ela depois do fim da evacuação não pode ver "Confirmar chegada"
  // de uma evacuação que já acabou.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    getEvacuationBackend()
      .getActive()
      .then(
        (a) => { if (!cancelled) setActive(a); },
        // Sem rede: fica o que já estava (na 1ª consulta, nada). A tela da
        // rota continua útil sem a barra.
        () => {},
      );
    return () => { cancelled = true; };
  }, []));

  const confirm = useCallback(async () => {
    if (!active || busy) return;
    setBusy(true);
    setError(null);
    try {
      await getEvacuationBackend().ack(active.id);
      // Ack é idempotente no backend; otimista aqui — o X real vive no admin.
      setActive({ ...active, myAck: true, ackedCount: active.ackedCount + 1 });
    } catch (e) {
      setError((e as Error)?.message ?? 'Não foi possível confirmar');
    } finally {
      setBusy(false);
    }
  }, [active, busy]);

  if (!active) return null;

  return (
    <View
      testID="evacuation-ack-bar"
      style={{
        position: 'absolute',
        left: theme.gap.m,
        right: theme.gap.m,
        // Flutua acima do cluster de FABs (Home central + Chat), senão o
        // círculo do Home cobre o meio da barra.
        bottom: insets.bottom + NAV_FABS_HEIGHT + theme.gap.m,
        gap: theme.gap.s,
      }}
    >
      {active.myAck ? (
        <StatusTag
          status="accept"
          fullWidth
          numberOfLines={2}
          label="Presença confirmada no ponto de encontro"
        />
      ) : (
        <Button
          label={busy ? 'Confirmando…' : 'Confirmar chegada ao ponto de encontro'}
          backgroundColor={theme.surface.error}
          onPress={() => void confirm()}
        />
      )}
      {error ? (
        <View
          style={{
            backgroundColor: theme.surface.errorLight,
            borderRadius: theme.border.radius.m,
            paddingVertical: theme.padding.xs,
            paddingHorizontal: theme.padding.m,
            alignItems: 'center',
          }}
        >
          <Text variant="body.s" color={theme.content.dark}>{error}</Text>
        </View>
      ) : null}
    </View>
  );
}
