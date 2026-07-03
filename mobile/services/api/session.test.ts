import { setUserId, getUserId, clearUserId } from './session'
describe('session singleton', () => {
  afterEach(() => clearUserId())
  it('default vazio', () => { expect(getUserId()).toBe('') })
  it('set/get', () => { setUserId('u1'); expect(getUserId()).toBe('u1') })
  it('clear volta a vazio', () => { setUserId('u1'); clearUserId(); expect(getUserId()).toBe('') })
})
