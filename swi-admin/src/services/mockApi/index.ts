export { authApi } from './auth'
// dashboard migrou pra api/dashboard.ts (fan-out real + vitais mock); saiu deste
// barrel mock no Passo 5.
export type { MockResponse, MockChannel, MockError, MockRealtimeEvent } from './types'
