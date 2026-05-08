import { authApi, SESSION_STORAGE_KEY } from './auth'

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

describe('authApi.signIn (persistence)', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('stores the user in localStorage on success', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY)
    expect(raw).not.toBeNull()
    expect(JSON.parse(raw!).email).toBe('admin@swi.test')
  })

  it('does not write to localStorage on failure', async () => {
    await authApi.signIn({ email: 'wrong@swi.test', password: 'no' })
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('authApi.signOut', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('clears the localStorage session', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    await authApi.signOut()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).toBeNull()
  })
})

describe('authApi.getSession', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('returns null when nothing in localStorage', async () => {
    const result = await authApi.getSession()
    expect(result.data).toBeNull()
    expect(result.error).toBeNull()
  })

  it('returns the stored user when present', async () => {
    await authApi.signIn({ email: 'admin@swi.test', password: 'demo1234' })
    const result = await authApi.getSession()
    expect(result.data?.email).toBe('admin@swi.test')
  })
})

describe('authApi.signUp', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('creates a user in the seed org and signs in', async () => {
    const result = await authApi.signUp({
      email: 'novo@swi.test',
      password: 'novo1234',
      full_name: 'Novo Usuario',
      consent: true,
    })
    expect(result.error).toBeNull()
    expect(result.data?.email).toBe('novo@swi.test')
    expect(result.data?.org_id).toBe('org_seed_1')
    expect(result.data?.role).toBe('admin')
    expect(result.data?.consent_given_at).not.toBeNull()
    expect(window.localStorage.getItem(SESSION_STORAGE_KEY)).not.toBeNull()
  })

  it('rejects when consent is false', async () => {
    const result = await authApi.signUp({
      email: 'nope@swi.test',
      password: 'nope1234',
      full_name: 'Sem Consent',
      consent: false,
    })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/consent/i)
  })

  it('rejects when email already exists', async () => {
    const result = await authApi.signUp({
      email: 'admin@swi.test',
      password: 'whatever',
      full_name: 'Duplicate',
      consent: true,
    })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/already/i)
  })
})

describe('authApi.requestPasswordReset', () => {
  it('always returns success (no enumeration leak)', async () => {
    const result = await authApi.requestPasswordReset({ email: 'whatever@swi.test' })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ sent: true })
  })
})

describe('authApi.resetPassword', () => {
  it('accepts any non-empty token + password', async () => {
    const result = await authApi.resetPassword({ token: 'tok123', newPassword: 'novo1234' })
    expect(result.error).toBeNull()
    expect(result.data).toEqual({ reset: true })
  })

  it('rejects empty token', async () => {
    const result = await authApi.resetPassword({ token: '', newPassword: 'novo1234' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/token/i)
  })

  it('rejects short password', async () => {
    const result = await authApi.resetPassword({ token: 'tok', newPassword: '123' })
    expect(result.data).toBeNull()
    expect(result.error?.message).toMatch(/password/i)
  })
})
