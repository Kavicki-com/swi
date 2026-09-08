import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Text, Title, TopBar, useTheme } from '@kavicki/swi-design-system';
import {
  activateMonitoring,
  useWatchDiagnostics,
} from '../../../services/telemetry/watchDiagnostics';
import { deriveTelemetryAvailability } from '../../../services/telemetry/telemetryAvailability';
import { telemetryCopy, telemetryUploadCopy } from '../../../services/telemetry/telemetryCopy';
import { useNow } from '../../../services/telemetry/useNow';
import { useTelemetryUpload } from '../../../services/telemetry/useTelemetryUpload';

// Porta de reentrada do monitoramento. Quem tocou "Configurar depois" no
// cadastro, ou negou na folha do sistema, volta por aqui. Mesmo vocabulário da
// tela final do primeiro uso (CONTEXT.md), e mesma regra: nenhuma frase afirma
// que a permissão foi negada, porque o iOS não conta isso (ADR-0004).

const pad = (n: number) => String(n).padStart(2, '0');

function formatHoraLocal(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '--:--:--';
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}


export default function WatchDiagnostics() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const estado = useWatchDiagnostics();
  // Enquanto esta tela está montada, o batimento vai ao backend. É a tela que
  // fica aberta durante a prova do piloto; as do primeiro uso são de passagem.
  const envio = useTelemetryUpload();
  const [ativando, setAtivando] = useState(false);

  const disponibilidade = deriveTelemetryAvailability(estado, useNow());
  const copy = telemetryCopy(disponibilidade, 'configuracoes');
  // Decisao congelada do plano: sem sessao ativa, a ultima leitura permanece
  // visivel com horario e qualidade. Some-la acima de 120s apagaria o unico
  // dado real que chegou, entao vem do estado bruto e nao da derivacao.
  const leitura = estado.support === 'ready' ? estado.lastSample : null;

  // Com a sessão espelhada já ativa, ativar de novo não faria nada: o botão sai.
  const podeAtivar = estado.support === 'ready' && estado.session !== 'running';

  const ativar = async () => {
    setAtivando(true);
    await activateMonitoring();
    setAtivando(false);
  };

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/login-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.xxl,
          paddingBottom: insets.bottom + theme.padding.xxl,
          paddingHorizontal: theme.padding.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <TopBar title="Monitoramento" onBack={() => router.back()} />

        <View style={{ gap: theme.gap.l, marginTop: theme.padding.xxl }}>
          <View style={{ gap: theme.gap.s }}>
            <Title variant="title.xs" color={theme.content.dark}>
              {copy.titulo}
            </Title>
            <Text variant="body.s" color={theme.content.dark}>
              {copy.corpo}
            </Text>
          </View>

          {estado.support === 'ready' && (
            <View style={{ gap: theme.gap.s }}>
              <Text variant="caption.s" color={theme.content.dark}>
                {disponibilidade.kind === 'current' ? 'BPM atual' : 'Última leitura'}
              </Text>
              {leitura ? (
                <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: theme.gap.s }}>
                  <Title variant="title.l" color={theme.content.dark}>
                    {String(Math.round(leitura.bpm))}
                  </Title>
                  <Text variant="body.m" color={theme.content.dark}>
                    bpm
                  </Text>
                  <Text variant="caption.s" color={theme.content.dark}>
                    {`medido às ${formatHoraLocal(leitura.measuredAt)}`}
                  </Text>
                </View>
              ) : (
                // Ausência nunca vira zero.
                <Text variant="body.m" color={theme.content.dark}>
                  Sem leitura ainda
                </Text>
              )}
            </View>
          )}

          {/* Só a prova de que o caminho até o backend existe; a tela de
              produto é da Task 11. Sem suporte não há o que enviar. */}
          {estado.support === 'ready' && (
            <Text variant="body.s" color={theme.content.dark}>
              {telemetryUploadCopy(envio.paired)}
            </Text>
          )}

          {podeAtivar && (
            <Button
              variant="contained"
              label="Ativar monitoramento"
              fullWidth
              disabled={ativando}
              onPress={() => {
                void ativar();
              }}
            />
          )}
        </View>
      </ScrollView>
    </View>
  );
}
