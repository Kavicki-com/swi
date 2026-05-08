import { authApi } from './auth'

describe('authApi.signIn', () => {
  it('returns a User on valid credentials', async () => {
    const result = await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    expect(result.error).toBeNull()
    expect(result.data?.email).toBe('admin@swi.test')
  })

  it('returns an error on invalid credentials', async () => {
    const result = await authApi.signIn({ email: 'nope@swi.test', password: 'wrong' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/invalid/i)
  })
})
