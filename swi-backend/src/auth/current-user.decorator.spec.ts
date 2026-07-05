import { ExecutionContext } from '@nestjs/common'
import { currentUserFactory, currentUserIdFactory } from './current-user.decorator'

const ctx = (user: any): ExecutionContext =>
  ({ switchToHttp: () => ({ getRequest: () => ({ user }) }) }) as any

describe('currentUserFactory', () => {
  it('retorna o req.user completo', () => {
    expect(currentUserFactory(undefined, ctx({ userId: 'w1', role: 'WORKER' }))).toEqual({ userId: 'w1', role: 'WORKER' })
  })
})

describe('currentUserIdFactory', () => {
  it('extrai req.user.userId', () => {
    expect(currentUserIdFactory(undefined, ctx({ userId: 'w1', role: 'WORKER' }))).toBe('w1')
  })
})
