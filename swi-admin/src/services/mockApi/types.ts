import type { ServiceError, ServiceResponse } from '@/services/types'

// Aliases locais do envelope compartilhado (services/types): dentro deste
// diretório os nomes Mock* deixam claro que o dado é simulado.
export type MockError = ServiceError
export type MockResponse<T> = ServiceResponse<T>

export type MockRealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export type MockChannel = {
  subscribe(): MockChannel
  unsubscribe(): void
  on(event: MockRealtimeEvent, cb: (payload: unknown) => void): MockChannel
}
