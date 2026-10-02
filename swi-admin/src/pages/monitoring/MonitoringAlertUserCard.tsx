// src/pages/monitoring/MonitoringAlertUserCard.tsx
// Cartão de um funcionário na lista do monitoramento: cabeçalho com
// identificação, ações de chat e localização, e, expandido, os alertas com
// a triagem e as ações de exames e pausa. O layout decide o que entra na
// lista; este arquivo só desenha uma pessoa.
import { Pressable, View } from 'react-native'
import {
  Avatar,
  Button,
  Icon,
  Text,
  Toggle,
  useTheme,
  type IconName,
} from '@kavicki/swi-design-system'
import type { MonitoringAlertDetail, MonitoringUserAlert } from '@/services/monitoring'
import { formatAge } from '@/lib/formatAge'
function ActionIcon({
  icon,
  label,
  onPress,
}: {
  icon: IconName
  label: string
  onPress: () => void
}) {
  const theme = useTheme()
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={{
        backgroundColor: theme.surface.high,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.sm,
        paddingVertical: theme.padding.sm,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Icon name={icon} size={24} color={theme.content.dark} />
    </Pressable>
  )
}

function VerticalDivider() {
  const theme = useTheme()
  return <View style={{ width: 2, height: 56, backgroundColor: theme.content.lightGrey }} />
}

function AlertRow({
  alert,
  pending,
  onAcknowledge,
  onResolve,
}: {
  alert: MonitoringAlertDetail
  pending: boolean
  onAcknowledge: (alertId: string) => void
  onResolve: (alertId: string) => void
}) {
  const theme = useTheme()
  const triage = alert.triage
  // Per the spec: all alert row icons render in content.dark (white) regardless
  // of tone. Tone-based colouring (error red / warning orange) didn't match
  // the design.
  return (
    <View
      testID={`alert-row-${alert.id}`}
      style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.m, width: '100%' }}
    >
      <Icon name={alert.icon} size={28} color={theme.content.dark} />
      <View style={{ flex: 1, gap: 5 }}>
        <Text
          variant="body.m"
          color={theme.content.dark}
          style={{ fontWeight: '700', fontSize: 16 }}
        >
          {alert.title}
        </Text>
        <Text variant="body.m" color={theme.content.dark}>
          {alert.description}
        </Text>
        {(alert.notes ?? []).map((note) => (
          <Text key={note} variant="body.s" color={theme.content.medium}>
            {note}
          </Text>
        ))}
        {triage?.triageLine ? (
          <Text variant="body.s" color={theme.content.medium}>
            {triage.triageLine}
          </Text>
        ) : null}
      </View>
      {/* Triagem: a tela só muda com a resposta do servidor, então dois admins
          olhando a mesma fila nunca veem um estado que não existe. */}
      {triage && (triage.canAcknowledge || triage.canResolve) ? (
        <View style={{ flexDirection: 'row', gap: theme.gap.s }}>
          {triage.canAcknowledge ? (
            <Button
              label="Reconhecer"
              variant="outline"
              labelColor={theme.content.primary}
              borderColor={theme.content.primary}
              accessibilityLabel={`Reconhecer alerta: ${alert.title}`}
              disabled={pending}
              onPress={() => onAcknowledge(triage.alertId)}
            />
          ) : null}
          {triage.canResolve ? (
            <Button
              label="Resolver"
              variant="contained"
              accessibilityLabel={`Resolver alerta: ${alert.title}`}
              disabled={pending}
              onPress={() => onResolve(triage.alertId)}
            />
          ) : null}
        </View>
      ) : null}
    </View>
  )
}

export function AlertUserCard({
  user,
  expanded,
  onToggle,
  onChat,
  onLocation,
  onViewExams,
  onPause,
  pausing,
  pendingAlerts,
  onAcknowledge,
  onResolve,
}: {
  user: MonitoringUserAlert
  expanded: boolean
  onToggle: () => void
  onChat: () => void
  onLocation: () => void
  onViewExams: () => void
  onPause: () => void
  pausing: boolean
  pendingAlerts: ReadonlySet<string>
  onAcknowledge: (alertId: string) => void
  onResolve: (alertId: string) => void
}) {
  const theme = useTheme()
  const hasAlerts = user.alerts.length > 0

  const header = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        width: '100%',
      }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.xl }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
          <Avatar uri={user.avatarUri} customSize={64} accessibilityLabel={user.name} />
          <View style={{ width: 220, gap: 4 }}>
            <View>
              <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
                {user.name}
              </Text>
              <Text variant="body.m" color={theme.content.dark}>
                {formatAge(user.age)}
              </Text>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Icon name="humidity_mid" size={20} color={theme.content.error} />
              <Text
                variant="body.m"
                color={theme.content.dark}
                style={{ fontWeight: '700', fontSize: 16 }}
              >
                {user.bloodType}
              </Text>
            </View>
          </View>
        </View>
        <VerticalDivider />
        <View style={{ width: 186, gap: 4 }}>
          <Text variant="body.m" color={theme.content.dark} style={{ fontWeight: '700' }}>
            {user.role}
          </Text>
          <Text variant="body.m" color={theme.content.dark}>
            {user.specialization}
          </Text>
        </View>
        <VerticalDivider />
        <Toggle
          defaultValue={user.active}
          accessibilityLabel={`Ativar/desativar monitoramento de ${user.name}`}
        />
      </View>
      {/* Sem "remover do monitoramento": não há ação no backend que faça
          isso, e um botão que só mostra um aviso fingiria ter feito. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: theme.gap.s }}>
        <ActionIcon icon="chat_bubble" label={`Chat com ${user.name}`} onPress={onChat} />
        <ActionIcon icon="location_on" label={`Localização de ${user.name}`} onPress={onLocation} />
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${expanded ? 'Recolher' : 'Expandir'} alertas de ${user.name}`}
        onPress={hasAlerts ? onToggle : undefined}
        disabled={!hasAlerts}
        style={{ paddingHorizontal: theme.padding.xs, paddingVertical: theme.padding.sm }}
      >
        <View style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}>
          <Icon name="keyboard_arrow_down" size={16} color={theme.content.dark} />
        </View>
      </Pressable>
    </View>
  )

  return (
    <View
      testID={`alert-user-${user.id}`}
      style={{
        backgroundColor: theme.surface.standard,
        borderRadius: theme.border.radius.m,
        paddingHorizontal: theme.padding.m,
        paddingVertical: theme.padding.s,
        gap: theme.gap.m,
      }}
    >
      {header}
      {expanded && hasAlerts ? (
        <>
          <View style={{ height: 2, backgroundColor: theme.content.lightGrey, width: '100%' }} />
          {/* Expanded details row: padding at theme.padding.sm and 18 px of
              vertical gap between alerts, both approved by the client. The
              51 px column gap stays as is, matching the horizontal rhythm
              between alerts and CTAs. */}
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              gap: 51,
              padding: theme.padding.sm,
            }}
          >
            <View style={{ flex: 1, gap: 18 }}>
              {user.alerts.map((a) => (
                <AlertRow
                  key={a.id}
                  alert={a}
                  pending={pendingAlerts.has(a.id)}
                  onAcknowledge={onAcknowledge}
                  onResolve={onResolve}
                />
              ))}
            </View>
            {/* Sem "ligar para o funcionário": o cadastro do painel não traz
                telefone por funcionário, e o botão só mostrava um aviso. */}
            <View style={{ width: 220, gap: theme.gap.sm }}>
              <Button
                label="Histórico de exames clínicos"
                variant="outline"
                labelColor={theme.content.primary}
                borderColor={theme.content.primary}
                fullWidth
                accessibilityLabel="Ver histórico de exames clínicos"
                onPress={onViewExams}
              />
              <Button
                label={pausing ? 'Enviando…' : 'Enviar alerta de pausa'}
                variant="contained"
                backgroundColor={theme.surface.accent}
                fullWidth
                accessibilityLabel="Enviar alerta de pausa"
                disabled={pausing}
                onPress={onPause}
              />
            </View>
          </View>
        </>
      ) : null}
    </View>
  )
}
