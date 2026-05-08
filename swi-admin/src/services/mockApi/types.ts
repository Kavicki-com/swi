export type MockError = { message: string; code?: string }

export type MockResponse<T> = {
  data: T | null
  error: MockError | null
  count?: number
}

export type MockRealtimeEvent = 'INSERT' | 'UPDATE' | 'DELETE'

export type MockChannel = {
  subscribe(): MockChannel
  unsubscribe(): void
  on(event: MockRealtimeEvent, cb: (payload: unknown) => void): MockChannel
}
