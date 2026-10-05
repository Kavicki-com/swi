// Aviso geral de sem conexão com o servidor: o Toast do DS, fixo no topo da
// tela enquanto durar a queda, e sem botão de fechar, porque some sozinho
// quando a conexão volta. Fica no topo para não cobrir o Toast de ação
// (lib/demoToast), que aparece embaixo.
import { Toast, useTheme } from '@kavicki/swi-design-system'
import { useConnectionLost } from '@/hooks/useConnectionLost'

export function ConnectionNotice() {
  const theme = useTheme()
  const lost = useConnectionLost()
  if (!lost) return null
  return (
    <div
      style={{
        position: 'fixed',
        top: theme.gap.l,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        // Só informa: os cliques passam para a tela de baixo.
        pointerEvents: 'none',
      }}
    >
      <Toast
        variant="warning"
        title="Sem conexão com o servidor."
        message="Os dados na tela podem estar desatualizados. Tentando reconectar."
        testID="connection-notice"
      />
    </div>
  )
}
