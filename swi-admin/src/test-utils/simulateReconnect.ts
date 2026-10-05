// Simula uma queda e a volta de um socket no armazém real de conexão do
// painel, para testar quem relê pela API quando a conexão volta. O socket de
// mentira sai do registro no fim, sem deixar estado para o próximo teste.
import { connectionStatus } from '@/services/realtime/connectionStatus'

export function simulateReconnect(): void {
  const handlers = new Map<string, (reason?: unknown) => void>()
  const unwatch = connectionStatus.watch({
    on: (event, h) => handlers.set(event, h),
    off: (event) => handlers.delete(event),
  })
  handlers.get('connect')?.()
  handlers.get('disconnect')?.('transport close')
  handlers.get('connect')?.()
  unwatch()
}
