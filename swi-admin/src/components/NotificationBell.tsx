// Sino do cabeçalho: o botão do DS com o contador de não lidas e, ao abrir, a
// lista no Popover do DS. Os itens compõem Title e Text do DS como o cartão de
// notificação do app (título, texto e marca de não lida), mais a hora.
//
// Abrir relê a lista: marcar como lida não chega às outras abas na hora, e é
// ao abrir que o admin olha.
import { useCallback, useEffect, useState } from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useNavigate } from 'react-router-dom'
import {
  Button,
  Icon,
  Popover,
  PopoverSeparator,
  Text,
  Title,
  useTheme,
} from '@kavicki/swi-design-system'
import { formatBadgeCount } from '@/app/nav'
import { useBrowserNotices } from '@/hooks/useBrowserNotices'
import { whenLabel } from '@/lib/whenLabel'
import type { NotificationDto } from '@/services/api/notifications'
import { useNotifications } from '@/services/notifications/NotificationsProvider'
import { setBellOpen } from '@/services/notifications/bellPanel'

/** Para onde o clique leva. Saúde vai à fila de alertas; o resto só marca como lida. */
const DESTINATION: Partial<Record<NotificationDto['domain'], string>> = {
  health: '/monitoring/alerts',
}

// Medidas da lista, sem token equivalente: larga o bastante para o título
// "Batimento alto: Nome" caber em uma linha, e com rolagem própria a partir de
// uns cinco itens para não passar da metade de uma tela de 768px.
const PANEL_WIDTH = 360
const LIST_MAX_HEIGHT = 420

const bellLabel = (unread: number) =>
  unread > 0 ? `Notificações, ${unread} não lida${unread > 1 ? 's' : ''}` : 'Notificações'

export function NotificationBell() {
  const theme = useTheme()
  const view = useNotifications()
  const notices = useBrowserNotices()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const close = useCallback(() => setOpen(false), [])

  // O aviso de alerta urgente sai da frente enquanto a lista está aberta;
  // sair da tela com a lista aberta também conta como fechar.
  useEffect(() => {
    setBellOpen(open)
  }, [open])
  useEffect(() => () => setBellOpen(false), [])

  if (!view) return null
  const { state, unread } = view

  const toggle = () => {
    if (!open) view.refresh()
    setOpen(!open)
  }

  const choose = (n: NotificationDto) => {
    view.markRead(n.id)
    const to = DESTINATION[n.domain]
    if (!to) return
    setOpen(false)
    navigate(to)
  }

  return (
    <Popover
      visible={open}
      onDismiss={close}
      align="end"
      minWidth={PANEL_WIDTH}
      accessibilityLabel="Notificações"
      trigger={
        // Contornado como o sino do app, mas pela variante ghost com borda: no
        // hover a contornada ganha fundo claro e o ícone claro some; a ghost
        // ganha o verde do painel e o ícone segue legível.
        <Button
          variant="ghost"
          size="large"
          shape="pill"
          borderWidth="s"
          borderColor={theme.content.dark}
          badge={formatBadgeCount(unread)}
          iconLeft={<Icon name="notifications" size={24} color={theme.content.dark} />}
          accessibilityLabel={bellLabel(unread)}
          onPress={toggle}
          testID="notification-bell"
        />
      }
    >
      <View style={{ width: PANEL_WIDTH, gap: theme.gap.s }}>
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: theme.gap.s,
            paddingHorizontal: theme.padding.s,
          }}
        >
          <Title variant="title.xs" color={theme.content.dark}>
            Notificações
          </Title>
          {unread > 0 ? (
            <Button
              variant="ghost"
              size="small"
              label="Marcar todas como lidas"
              accessibilityLabel="Marcar todas as notificações como lidas"
              onPress={view.markAllRead}
            />
          ) : null}
        </View>
        {state.status === 'failed' ? (
          <View style={{ gap: theme.gap.s, padding: theme.padding.s, alignItems: 'flex-start' }}>
            <Text variant="body.s" color={theme.content.dark}>
              Não foi possível carregar as notificações.
            </Text>
            <Button variant="outline" size="small" label="Tentar de novo" onPress={view.refresh} />
          </View>
        ) : state.status === 'ready' && state.items.length === 0 ? (
          <View style={{ padding: theme.padding.s }}>
            <Text variant="body.s" color={theme.content.dark}>
              Nenhuma notificação.
            </Text>
          </View>
        ) : (
          <ScrollView style={{ maxHeight: LIST_MAX_HEIGHT }}>
            {state.items.map((n, i) => (
              <View key={n.id}>
                {i > 0 ? <PopoverSeparator /> : null}
                <NotificationRow notification={n} onPress={choose} />
              </View>
            ))}
          </ScrollView>
        )}
        {/* Enquanto o navegador não respondeu, o sino oferece os avisos dele.
            O pedido sai do clique, que é quando os navegadores aceitam. */}
        {notices.support === 'default' && !notices.declined ? (
          <>
            <PopoverSeparator />
            <View style={{ gap: theme.gap.s, padding: theme.padding.s, alignItems: 'flex-start' }}>
              <Text variant="body.s" color={theme.content.dark}>
                Receba um aviso do navegador quando chegar um alerta urgente com o SWI em segundo
                plano.
              </Text>
              <Button
                variant="outline"
                size="small"
                label="Ativar avisos"
                onPress={() => void notices.request()}
              />
            </View>
          </>
        ) : null}
      </View>
    </Popover>
  )
}

function NotificationRow({
  notification: n,
  onPress,
}: {
  notification: NotificationDto
  onPress: (n: NotificationDto) => void
}) {
  const theme = useTheme()
  const when = whenLabel(n.createdAt, Date.now())
  return (
    <Pressable
      onPress={() => onPress(n)}
      accessibilityRole="button"
      accessibilityLabel={n.read ? n.title : `${n.title} (não lida)`}
      style={{ gap: theme.gap.xs, padding: theme.padding.s }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xs }}>
        {/* Marca de não lida: o ponto do cartão de notificação do app. */}
        {!n.read ? (
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: theme.border.radius.pill,
              backgroundColor: theme.surface.secondary,
            }}
          />
        ) : null}
        <Title variant="title.xs" color={theme.content.dark} numberOfLines={2}>
          {n.title}
        </Title>
      </View>
      {n.body ? (
        <Text variant="body.s" color={theme.content.dark}>
          {n.body}
        </Text>
      ) : null}
      {when ? (
        <Text variant="caption.s" color={theme.content.medium}>
          {when}
        </Text>
      ) : null}
    </Pressable>
  )
}
