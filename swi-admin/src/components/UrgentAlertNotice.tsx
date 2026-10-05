// Aviso de alerta urgente: o Toast do DS em erro, com o botão que leva à fila
// de alertas, como o "Evacuar área" do alerta de chuva no desenho. Um aviso só,
// que resume quando há vários. "Ver" e "Fechar" escondem os alertas que estão
// nele; alerta novo traz o aviso de volta; some sozinho quando ninguém mais
// tem o alerta aberto. Enquanto a lista do sino está aberta, sai da frente.
import { useNavigate } from 'react-router-dom'
import { Toast } from '@kavicki/swi-design-system'
import { URGENT_ALERTS_PATH, useUrgentAlerts } from '@/services/alerts/UrgentAlertsProvider'
import { noticeText } from '@/services/alerts/urgentAlerts'
import { useBellOpen } from '@/services/notifications/bellPanel'

export function UrgentAlertNotice() {
  const view = useUrgentAlerts()
  const bellOpen = useBellOpen()
  const navigate = useNavigate()
  if (!view || bellOpen) return null
  const text = noticeText(view.visible, Date.now())
  if (!text) return null
  return (
    <Toast
      variant="error"
      title={text.title}
      message={text.message}
      // Sem isto o leitor de tela anunciaria só o título.
      accessibilityLabel={`${text.title}. ${text.message}`}
      action={{
        label: 'Ver no monitoramento',
        onPress: () => {
          view.dismiss()
          navigate(URGENT_ALERTS_PATH)
        },
      }}
      onClose={view.dismiss}
      testID="urgent-alert-notice"
    />
  )
}
