// Botão de câmera sobre o minimapa (detalhe do funcionário e chat): abre o
// vídeo ao vivo de quem está transmitindo, ou avisa que a pessoa não está.
// A conferência é na hora do toque, pela lista do servidor.
import { useCallback, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { useDemoToast } from '@/lib/demoToast'
import { liveApi } from '@/services/api/live'

const TITLE = 'Câmera da posição'

export function useOpenLiveCamera(): (workerId: string | undefined, name: string) => Promise<void> {
  const navigate = useNavigate()
  const { show } = useDemoToast()
  // Quem saiu da tela enquanto a consulta ia e voltava já está em outro lugar.
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  return useCallback(
    async (workerId, name) => {
      const notLive = () => show(TITLE, `${name} não está transmitindo a câmera agora.`)
      // Sem id é quem não transmite nunca (o administrador): nem consulta.
      if (!workerId) {
        notLive()
        return
      }
      try {
        const live = await liveApi.list()
        if (!mounted.current) return
        if (live.some((b) => b.workerId === workerId)) {
          navigate(`/cameras?aba=ao-vivo&funcionario=${encodeURIComponent(workerId)}`)
        } else {
          notLive()
        }
      } catch {
        if (!mounted.current) return
        show(TITLE, 'Não foi possível conferir a transmissão. Tente de novo.')
      }
    },
    [navigate, show],
  )
}
