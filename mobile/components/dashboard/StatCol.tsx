import { memo, type ReactNode } from 'react';
import { View } from 'react-native';
import { Text, Title, useTheme } from '@kavicki/swi-design-system';

// Uma coluna da faixa de estatísticas do dashboard: ícone, valor, rótulo.
// Compõe primitivas do design system, não substitui nenhuma.
export const StatCol = memo(function StatCol({
  iconNode,
  label,
  value,
  width,
  theme,
}: {
  iconNode: ReactNode;
  label: string;
  value: string;
  width: number;
  theme: ReturnType<typeof useTheme>;
}) {
  return (
    <View style={{ alignItems: 'center', gap: theme.gap.sm, width }}>
      <View style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
        {iconNode}
      </View>
      {/* O valor fica em uma linha. O rótulo diz por que falta o valor
          ("Esta pulseira não envia pressão", "Sincronização falhou às
          14:10") e quebra em até três linhas, centralizado: cortado ele
          mentiria. O hero encolhe pela altura medida deste bloco, então o
          rodapé continua na tela. */}
      <Title variant="title.l" color={theme.content.dark} numberOfLines={1}>
        {value}
      </Title>
      <Text
        variant="body.s"
        color={theme.content.dark}
        numberOfLines={3}
        style={{ textAlign: 'center' }}
      >
        {label}
      </Text>
    </View>
  );
});
