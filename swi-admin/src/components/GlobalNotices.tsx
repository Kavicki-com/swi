// Coluna fixa no topo, centralizada, para os avisos que valem em todas as
// telas logadas (montada no ChatShell, que cobre também Mapas e Chat): o de
// sem conexão em cima e o de alerta urgente embaixo. Fica no topo para não
// cobrir o Toast de ação (lib/demoToast), que aparece embaixo.
import { useTheme } from '@kavicki/swi-design-system'
import { ConnectionNotice } from './ConnectionNotice'
import { UrgentAlertNotice } from './UrgentAlertNotice'

// Logo abaixo dos cabeçalhos (o mais alto, o do layout com menu, tem 96px: o
// avatar de 64 e o respiro de 16 em cima e embaixo). No alto da tela, o aviso
// de alerta, que é largo, cobriria o sino e o avatar.
export const NOTICES_TOP = 104

export function GlobalNotices() {
  const theme = useTheme()
  return (
    <div
      data-testid="global-notices"
      style={{
        position: 'fixed',
        top: NOTICES_TOP,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: theme.gap.s,
        width: `min(560px, calc(100vw - ${theme.gap.l * 2}px))`,
        // O aviso de conexão só informa: os cliques passam para a tela de baixo.
        pointerEvents: 'none',
      }}
    >
      <ConnectionNotice />
      <div style={{ alignSelf: 'stretch', pointerEvents: 'auto' }}>
        <UrgentAlertNotice />
      </div>
    </div>
  )
}
