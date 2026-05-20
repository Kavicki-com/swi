import { Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, JourneyTheme, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { ProdOnlyPlaceholder } from '../../components/ProdOnlyPlaceholder';
import { isFeatureEnabled } from '../../lib/featureFlags';

// Figma 401:30469 — notifications list. Title + 12 notification cards
// compose-local (DS HorizontalCard sem description) + Chat FAB + Home
// FAB. Demo phase: cards estáticos, more_vert icon sem menu real.
//
// Routing table (Sprint 1.2): cada card abre uma rota canônica para o
// domínio da notificação. Todas as rotas existem; nenhuma cria 404.
// - Alerta meteorológico  → mapa meteorológico (visualização do fenômeno;
//   o estado de "alerta ativo" do dashboard segue acessível pelo botão SOS
//   no próprio dashboard). Ver R-5 em 2026-05-17-mobile-routes-audit.md.
// - Atividade/feedback/comentário → chat inbox (mensagens da equipe)
// - Novo relatório / qualidade  → lista de relatórios
// - Treinamento / tarefa / inspeção / cronograma → jornada
// - Atualização de procedimento → FAQ

type Href =
  | '/(app)/dashboard?alert=modal'
  | '/(app)/chat/inbox'
  | '/(app)/reports'
  | '/(app)/journey'
  | '/(app)/settings/faq';

const NOTIFICATIONS: {
  id: string;
  title: string;
  body: string;
  href: Href;
}[] = [
  {
    id: 'alerta-meteorologico',
    title: 'Alerta Meteorológico',
    body: 'Aviso de tempestades fortes previstas para as próximas 24 horas, tome precauções necessárias.',
    // Dispara o fluxo do alert modal: dashboard com gradient vermelho +
    // modal "Local em Alerta!" aparece após 800ms (dissolve 240ms). User
    // clica "Instruções de segurança" → vai pro timeline `?alert=active`.
    href: '/(app)/dashboard?alert=modal',
  },
  {
    id: 'atividade-colaborador',
    title: 'Atividade de Colaborador',
    body: 'Ana atualizou o status da manutenção preventiva no setor de produção.',
    href: '/(app)/chat/inbox',
  },
  {
    id: 'feedback-recebido',
    title: 'Feedback Recebido',
    body: 'Equipe reportou melhorias significativas após implementação das novas diretrizes.',
    href: '/(app)/chat/inbox',
  },
  {
    id: 'novo-relatorio',
    title: 'Novo Relatório Atribuído',
    body: 'Relatório de segurança do setor 5 foi designado para sua análise.',
    href: '/(app)/reports',
  },
  {
    id: 'relatorio-qualidade',
    title: 'Relatório de Qualidade',
    body: 'Análise dos indicadores de qualidade do último trimestre disponível para revisão.',
    href: '/(app)/reports',
  },
  {
    id: 'treinamento',
    title: 'Notificação de Treinamento',
    body: 'Curso sobre normas ambientais será oferecido na próxima quarta-feira.',
    href: '/(app)/journey',
  },
  {
    id: 'nova-tarefa',
    title: 'Nova Tarefa Atribuída',
    body: 'Realizar auditoria dos processos de armazenamento até o final da semana.',
    href: '/(app)/journey',
  },
  {
    id: 'nova-inspecao',
    title: 'Nova Inspeção Programada',
    body: 'Agendada inspeção de segurança elétrica para a próxima segunda-feira.',
    href: '/(app)/journey',
  },
  {
    id: 'cronograma',
    title: 'Mudança no Cronograma',
    body: 'Prazo para envio de relatórios técnicos foi estendido em duas semanas.',
    href: '/(app)/journey',
  },
  {
    id: 'comentario-relatorio',
    title: 'Comentário em Relatório',
    body: `Carlos comentou: 'Verificar a conformidade dos equipamentos com a norma ISO 9001.'`,
    href: '/(app)/chat/inbox',
  },
  {
    id: 'atualizacao-procedimento',
    title: 'Atualização de Procedimento',
    body: 'Procedimento de emergência revisado e disponível para consulta.',
    href: '/(app)/settings/faq',
  },
  {
    id: 'novo-comentario',
    title: 'Novo Comentário',
    body: `João observou: 'Necessário reforçar monitoramento durante turnos noturnos.'`,
    href: '/(app)/chat/inbox',
  },
];

export default function Notifications() {
  if (!isFeatureEnabled('notifications')) {
    return <ProdOnlyPlaceholder />;
  }
  return <NotificationsScreen />;
}

function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../assets/reports-bg.png')}
        pattern={require('../../assets/smartband-bg-pattern.png')}
      />

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
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
              onPress={() => router.push(notif.href)}
              accessibilityRole="button"
              accessibilityLabel={notif.title}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: theme.gap.sm,
                backgroundColor: theme.surface.standard,
                borderRadius: theme.border.radius.m,
                padding: theme.padding.sm,
                shadowColor: theme.shadow.color,
                shadowOffset: { width: 0, height: 4 },
                shadowOpacity: 0.08,
                shadowRadius: 8,
                elevation: 2,
              }}
            >
              <View style={{ flex: 1, gap: theme.gap.s }}>
                <Title
                  variant="title.xs"
                  color={theme.content.dark}
                  numberOfLines={1}
                >
                  {notif.title}
                </Title>
                <Text variant="body.s" color={theme.content.dark}>
                  {notif.body}
                </Text>
              </View>
              <Pressable
                // Phase 2: notification context menu (arquivar / marcar como lida
                // / remover). Figma 401:30469 mostra o ícone sem definir o menu;
                // sem spec a ação correta é repetir o destino do card.
                onPress={() => router.push(notif.href)}
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

      <NavFABs />
    </View>
  );
}
