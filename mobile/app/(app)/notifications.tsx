import { memo, useCallback, useState } from 'react';
import { Modal, Pressable, ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Icon, JourneyTheme, Text, Title, useTheme } from '@kavicki/swi-design-system';
import { NavFABs } from '../../components/NavFABs';
import { ProdOnlyPlaceholder } from '../../components/ProdOnlyPlaceholder';
import { ActiveAlertModal } from '../../components/modals/ActiveAlertModal';
import { WeatherAlertModal } from '../../components/modals/WeatherAlertModal';
import { isFeatureEnabled } from '../../lib/featureFlags';
import { useNotifications } from '../../services/notifications/NotificationProvider';
import type { AppNotification, NotificationDomain } from '../../services/notifications/types';
import { NotificationState } from '../../components/notifications/NotificationState';

// (DS HorizontalCard sem description) + Chat FAB + Home FAB. Unit 3 (backend):
// a lista agora vem ao vivo do NotificationProvider (Unit 2) em vez do array
// estático; more_vert icon segue decorativo (sem menu real).
//
// Routing table: cada card abre uma rota canônica para o domínio da
// notificação. Todas as rotas existem; nenhuma cria 404.
// - weather  → WeatherAlertModal in-place (visualização do fenômeno; o estado
//   de "alerta ativo" do dashboard segue acessível pelo botão SOS no próprio
//   dashboard). Caso especial: NÃO navega, abre modal. Ver R-5 em
// - chat     → chat inbox (mensagens da equipe)
// - reports  → lista de relatórios
// - journey  → jornada (treinamento / tarefa / inspeção / cronograma)
// - faq      → FAQ (atualização de procedimento)

type Href =
  | '/(app)/chat/inbox'
  | '/(app)/reports'
  | '/(app)/journey'
  | '/(app)/settings/faq'
  | '/(app)/evacuation';

const DOMAIN_ROUTE: Record<Exclude<NotificationDomain, 'weather'>, Href> = {
  chat: '/(app)/chat/inbox',
  reports: '/(app)/reports',
  journey: '/(app)/journey',
  faq: '/(app)/settings/faq',
  // de presença vive lá.
  evacuation: '/(app)/evacuation',
};

// T4.4: NotificationCard memoizado pra impedir que os cards re-renderizem
// quando weatherAlertVisible/activeAlertVisible togglam. Props estáveis:
// `notif` (item da lista do provider) + `onPress` (useCallback no parent).
type NotificationCardProps = {
  notif: AppNotification;
  onPress: (id: string) => void;
  theme: ReturnType<typeof useTheme>;
};
const NotificationCard = memo(function NotificationCard({
  notif,
  onPress,
  theme,
}: NotificationCardProps) {
  const handlePress = useCallback(() => onPress(notif.id), [notif.id, onPress]);
  return (
    <Pressable
      onPress={handlePress}
      accessibilityRole="button"
      accessibilityLabel={notif.read ? notif.title : `${notif.title} (não lida)`}
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
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
          {/* Indicador de não-lida: dot azul (surface.secondary = accent
              cross-section, pois notificações são cross-domain). Cards lidos
              não renderizam o dot → byte-idênticos ao layout estático de hoje. */}
          {!notif.read && (
            <View
              style={{
                width: 8,
                height: 8,
                // dot de não-lida — pill arredonda o quadrado 8x8 num círculo
                borderRadius: theme.border.radius.pill,
                backgroundColor: theme.surface.secondary,
              }}
            />
          )}
          <Title
            variant="title.xs"
            color={theme.content.dark}
            numberOfLines={1}
          >
            {notif.title}
          </Title>
        </View>
        <Text variant="body.s" color={theme.content.dark}>
          {notif.body}
        </Text>
      </View>
      <Pressable
        onPress={handlePress}
        accessibilityRole="button"
        accessibilityLabel={`Opções para ${notif.title}`}
        hitSlop={8}
      >
        <Icon name="more_vert" size={24} color={theme.content.dark} />
      </Pressable>
    </Pressable>
  );
});

export default function Notifications() {
  if (!isFeatureEnabled('notifications')) {
    return <ProdOnlyPlaceholder />;
  }
  // Montar de novo criaria uma SEGUNDA instância de estado, e aí o badge do
  // dashboard e esta lista seriam fontes independentes: ler aqui não zeraria
  // o badge lá.
  return <NotificationsScreen />;
}

function NotificationsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { notifications, loadStatus, unreadCount, load, markRead, markAllRead } = useNotifications();
  // Weather alert is shown as an in-place modal instead of navigating away.
  // Backdrop tint usa surface.error (#f5667a) a ~18% — vermelho perceptível
  // mas suave (user spec: "deixe a tela atras levemente vermelha").
  const [weatherAlertVisible, setWeatherAlertVisible] = useState(false);
  // Active alert (procedimento de evacuação) — também aparece como modal
  // sobreposto à lista de notificações em vez de trocar de tela. User spec:
  // "no alerta atual ainda esta trocando de tela, quero ele exatamente como
  // o meteorológico". Disparado pelo CTA do WeatherAlertModal.
  const [activeAlertVisible, setActiveAlertVisible] = useState(false);

  // T4.4: useCallback estabiliza a referência do handler — NotificationCard
  // memoizado consegue skipar re-render quando só o modal state muda.
  const handleNotificationPress = useCallback(
    (id: string) => {
      const n = notifications.find((x) => x.id === id);
      if (!n) return;
      markRead(id); // otimista; navega/abre em seguida
      if (n.domain === 'weather') {
        setWeatherAlertVisible(true);
        return;
      }
      router.push(DOMAIN_ROUTE[n.domain]);
    },
    [notifications, markRead, router],
  );

  const isStateView =
    loadStatus === 'loading' || loadStatus === 'empty' || loadStatus === 'error';

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../assets/login-bg.png')}
        pattern={require('../../assets/smartband-bg-pattern.png')}
      />

      {isStateView ? (
        // loading/empty/error dentro do container do gradiente; onRetry só
        // importa pro 'error' (passar sempre é inofensivo).
        <NotificationState kind={loadStatus} onRetry={load} />
      ) : (
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
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <Title variant="title.xs" color={theme.content.dark}>
              Notificações
            </Title>
            {unreadCount > 0 && (
              <Button
                variant="ghost"
                label="Marcar todas como lidas"
                accessibilityLabel="Marcar todas as notificações como lidas"
                onPress={markAllRead}
              />
            )}
          </View>

          <View style={{ gap: theme.gap.s }}>
            {notifications.map((n) => (
              <NotificationCard
                key={n.id}
                notif={n}
                onPress={handleNotificationPress}
                theme={theme}
              />
            ))}
          </View>
        </ScrollView>
      )}

      <NavFABs />

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

      <ActiveAlertModal
        visible={activeAlertVisible}
        onClose={() => setActiveAlertVisible(false)}
      />
    </View>
  );
}
