import { useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, JourneyTheme, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { ProdOnlyPlaceholder } from '../../components/ProdOnlyPlaceholder';
import { ActiveAlertModal } from '../../components/modals/ActiveAlertModal';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';
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
  // Weather alert is shown as an in-place modal instead of navigating away.
  // Backdrop tint usa surface.error (#f5667a) a ~18% — vermelho perceptível
  // mas suave (user spec: "deixe a tela atras levemente vermelha").
  const [weatherAlertVisible, setWeatherAlertVisible] = useState(false);
  // Active alert (procedimento de evacuação) — também aparece como modal
  // sobreposto à lista de notificações em vez de trocar de tela. User spec:
  // "no alerta atual ainda esta trocando de tela, quero ele exatamente como
  // o meteorológico". Disparado pelo CTA do WeatherAlertModal.
  const [activeAlertVisible, setActiveAlertVisible] = useState(false);

  const handleNotificationPress = (notif: (typeof NOTIFICATIONS)[number]) => {
    if (notif.id === 'alerta-meteorologico') {
      setWeatherAlertVisible(true);
      return;
    }
    router.push(notif.href);
  };

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
              onPress={() => handleNotificationPress(notif)}
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
                onPress={() => handleNotificationPress(notif)}
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

      {/* Weather alert modal (Figma 385:29371) — opens in-place sobre a
          lista de notificações com backdrop levemente vermelho. CTA
          "Instruções de segurança" navega pro fluxo de evacuação ativa
          (`?alert=active`), mantendo o destino canônico do alert flow. */}
      <Modal
        visible={weatherAlertVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setWeatherAlertVisible(false)}
      >
        <Pressable
          onPress={() => setWeatherAlertVisible(false)}
          accessibilityLabel="Fechar alerta meteorológico"
          style={{
            flex: 1,
            // Backdrop "levemente vermelho" — surface.error (#f5667a) ~18%
            // opacity. Sutil, mas dá sinal visual de emergência mesmo sem
            // mudar a tela de fundo.
            backgroundColor: 'rgba(245, 102, 122, 0.18)',
            alignItems: 'center',
            justifyContent: 'center',
            padding: theme.padding.m,
          }}
        >
          {/* Inner Pressable absorve o toque pra não fechar quando o user
              clica DENTRO do modal. */}
          <Pressable onPress={() => {}} style={{ width: '100%', alignItems: 'center' }}>
            <WeatherAlertModal
              onClose={() => setWeatherAlertVisible(false)}
              onPrimaryAction={() => {
                // Fecha o weather modal e abre o active alert modal in-place
                // (mesmo backdrop vermelho). NÃO navega pro dashboard — esse
                // era o "trocando de tela" que o user reportou. A rota
                // canônica `?alert=active` segue válida pra outros entry
                // points (ex.: deep link), só não passamos por ela aqui.
                setWeatherAlertVisible(false);
                setActiveAlertVisible(true);
              }}
            />
          </Pressable>
        </Pressable>
      </Modal>

      {/* Active alert modal (Figma 385:29591) — procedimento de evacuação
          como overlay sobre a lista de notificações. Mesmo padrão visual do
          WeatherAlertModal: backdrop vermelho ~18%, card branco, tap fora
          fecha. */}
      <ActiveAlertModal
        visible={activeAlertVisible}
        onClose={() => setActiveAlertVisible(false)}
      />
    </View>
  );
}
