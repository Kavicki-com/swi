import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { RegisterPushTokenDto, RemovePushTokenDto } from './dto'

const check = <T extends object>(cls: new () => T, body: Record<string, unknown>) => {
  const dto = plainToInstance(cls, body)
  return validate(dto, { whitelist: true }).then((errors) => ({ dto, errors }))
}

const EXPONENT = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]'
const EXPO = 'ExpoPushToken[yyyyyyyyyyyyyyyyyyyyyy]'

describe('RegisterPushTokenDto', () => {
  it('aceita os dois formatos de token da Expo nas duas plataformas', async () => {
    expect((await check(RegisterPushTokenDto, { token: EXPONENT, platform: 'android' })).errors).toHaveLength(0)
    expect((await check(RegisterPushTokenDto, { token: EXPO, platform: 'ios' })).errors).toHaveLength(0)
  })

  it('apara o token colado com espaço', async () => {
    const { dto, errors } = await check(RegisterPushTokenDto, { token: `  ${EXPONENT} `, platform: 'ios' })
    expect(errors).toHaveLength(0)
    expect(dto.token).toBe(EXPONENT)
  })

  it('recusa token que não é da Expo (FCM cru, vazio, colchete vazio, com espaço dentro)', async () => {
    for (const token of ['fcm-token-cru', '', 'ExponentPushToken[]', 'ExponentPushToken[a b]', 'PushToken[abc]', 42]) {
      expect((await check(RegisterPushTokenDto, { token, platform: 'android' })).errors.length).toBeGreaterThan(0)
    }
  })

  it('recusa token comprido demais', async () => {
    const token = `ExponentPushToken[${'a'.repeat(300)}]`
    expect((await check(RegisterPushTokenDto, { token, platform: 'android' })).errors.length).toBeGreaterThan(0)
  })

  it('recusa plataforma fora de android e ios', async () => {
    expect((await check(RegisterPushTokenDto, { token: EXPONENT, platform: 'web' })).errors.length).toBeGreaterThan(0)
    expect((await check(RegisterPushTokenDto, { token: EXPONENT })).errors.length).toBeGreaterThan(0)
    expect((await check(RegisterPushTokenDto, { token: EXPONENT, platform: 'Android' })).errors.length).toBeGreaterThan(0)
  })
})

describe('RemovePushTokenDto', () => {
  it('aceita token da Expo e recusa o resto', async () => {
    expect((await check(RemovePushTokenDto, { token: EXPO })).errors).toHaveLength(0)
    expect((await check(RemovePushTokenDto, { token: 'qualquer' })).errors.length).toBeGreaterThan(0)
    expect((await check(RemovePushTokenDto, {})).errors.length).toBeGreaterThan(0)
  })
})
