import { Pressable, ScrollView, Text as RNText, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, Title, useTheme } from '@kavicki/swi-design-system';

// Figma 401:30469 — notifications list. Title + 12 notification cards
// compose-local (DS HorizontalCard sem description) + Chat FAB + Home
// FAB. Demo phase: cards estáticos, more_vert icon sem menu real.

const NOTIFICATIONS = [
  {
    id: 'alerta-meteorologico',
    title: 'Alerta Meteorológico',
    body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.',
  },
  {
    id: 'atividade-colaborador',
    title: 'Atividade de Colaborador',
    body: 'Ana atualizou o status da manutenção preventiva no setor de produção.',
  },
  {
    id: 'feedback-recebido',
    title: 'Feedback Recebido',
    body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.',
  },
  {
    id: 'novo-relatorio',
    title: 'Novo Relatório Atribuído',
    body: 'Relatório de segurança do setor 5 foi designado para sua análise.',
  },
  {
    id: 'relatorio-qualidade',
    title: 'Relatório de Qualidade',
    body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.',
  },
  {
    id: 'treinamento',
    title: 'Notificação de Treinamento',
    body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.',
  },
  {
    id: 'nova-tarefa',
    title: 'Nova Tarefa Atribuída',
    body: 'Realizar auditoria dos processos de armazenamento até o final da semana.',
  },
  {
    id: 'nova-inspecao',
    title: 'Nova Inspeção Programada',
    body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.',
  },
  {
    id: 'cronograma',
    title: 'Mudança no Cronograma',
    body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.',
  },
  {
    id: 'comentario-relatorio',
    title: 'Comentário em Relatório',
    body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`,
  },
  {
    id: 'atualizacao-procedimento',
    title: 'Atualização de Procedimento',
    body: 'Procedimento de emergência revisado e disponível para consulta.',
  },
  {
    id: 'novo-comentario',
    title: 'Novo Comentário',
    body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`,
  },
];

export default function Notifications() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + theme.padding.l,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
        showsVerticalScrollIndicator={false}
      >
        <Title variant="title.xs" color={theme.content.dark}>
          Notificações
        </Title>

        <View style={{ gap: theme.gap.s }}>
          {NOTIFICATIONS.map((notif) => (
            <Pressable
              key={notif.id}
              onPress={() => {}}
              accessibilityRole="button"
              accessibilityLabel={notif.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.sm,
                backgroundColor: theme.surface.standard,
                borderRadius: theme.border.radius.m,
                padding: theme.padding.sm,
                shadowColor: '#1D1D1D',
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.08,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <View style={{ flex: 1, gap: theme.gap.s }}>
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.title,
                    fontWeight: theme.fontWeight.bold,
                    fontSize: theme.fontSize.ms,
                    color: theme.content.dark,
                  }}
                  numberOfLines={1}
                >
                  {notif.title}
                </RNText>
                <RNText
                  style={{
                    fontFamily: theme.fontFamily.body,
                    fontWeight: theme.fontWeight.medium,
                    fontSize: theme.fontSize.sm,
                    color: theme.content.dark,
                  }}
                >
                  {notif.body}
                </RNText>
              </View>
              <Pressable
                onPress={() => {}}
                accessibilityRole="button"
                accessibilityLabel={`Opções para ${notif.title}`}
                hitSlop={8}
              >
                <Icon name="more_vert" size={24} color={theme.content.dark} />
              </Pressable>
            </Pressable>
          ))}
        </View>
      </ScrollView>

      {/* Chat FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          right: theme.padding.m,
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.surface.success}
          elevation="lg"
          iconLeft={
            <Icon
              name="chat_bubble"
              width={25.714}
              height={25.714}
              color={theme.content.light}
            />
          }
          accessibilityLabel="Abrir chat"
          onPress={() => router.push('/(app)/chat/inbox')}
        />
      </View>

      {/* Home FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
