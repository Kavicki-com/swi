// Aviso geral de sem conexão com o servidor: o Toast do DS enquanto durar a
// queda, sem botão de fechar, porque some sozinho quando a conexão volta. A
// posição, no topo da tela, vem da coluna de avisos (GlobalNotices).
import { Toast } from '@kavicki/swi-design-system'
import { useConnectionLost } from '@/hooks/useConnectionLost'

export function ConnectionNotice() {
  const lost = useConnectionLost()
  if (!lost) return null
  return (
    <Toast
      variant="warning"
      title="Sem conexão com o servidor."
      message="Os dados na tela podem estar desatualizados. Tentando reconectar."
      testID="connection-notice"
    />
  )
}
