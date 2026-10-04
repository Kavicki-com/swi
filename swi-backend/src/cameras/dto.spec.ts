import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateCameraDto, UpdateCameraDto } from './dto'

const valid = { name: 'Portaria', lat: -3.1, lng: -60.02, url: 'https://cameras.exemplo.com.br/portaria' }

const check = <T extends object>(cls: new () => T, body: Record<string, unknown>) => {
  const dto = plainToInstance(cls, body)
  return validate(dto, { whitelist: true }).then((errors) => ({ dto, errors }))
}

describe('CreateCameraDto', () => {
  it('aceita nome, coordenadas e endereço', async () => {
    expect((await check(CreateCameraDto, valid)).errors).toHaveLength(0)
  })

  it('endereço é opcional: o ponto pode entrar antes do link', async () => {
    expect((await check(CreateCameraDto, { name: 'Portaria', lat: -3.1, lng: -60.02 })).errors).toHaveLength(0)
    expect((await check(CreateCameraDto, { ...valid, url: null })).errors).toHaveLength(0)
  })

  it('apara o nome e rejeita nome vazio ou longo demais', async () => {
    const { dto } = await check(CreateCameraDto, { ...valid, name: '  Portaria  ' })
    expect(dto.name).toBe('Portaria')
    expect((await check(CreateCameraDto, { ...valid, name: '   ' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, name: 'x'.repeat(81) })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, name: 42 })).errors.length).toBeGreaterThan(0)
  })

  it('rejeita coordenada fora dos limites, em texto ou ausente', async () => {
    expect((await check(CreateCameraDto, { ...valid, lat: 90.1 })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, lng: -180.1 })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, lat: '-3.1' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { name: 'Portaria', lat: -3.1 })).errors.length).toBeGreaterThan(0)
  })

  it('apara o endereço colado com espaço', async () => {
    const { dto, errors } = await check(CreateCameraDto, { ...valid, url: '  https://cameras.exemplo.com.br/portaria \n' })
    expect(errors).toHaveLength(0)
    expect(dto.url).toBe('https://cameras.exemplo.com.br/portaria')
    expect((await check(UpdateCameraDto, { url: ' https://cameras.exemplo.com.br/patio ' })).dto.url).toBe('https://cameras.exemplo.com.br/patio')
  })

  it('endereço só http ou https, inclusive IP da rede da obra', async () => {
    expect((await check(CreateCameraDto, { ...valid, url: 'http://192.168.0.10:8080/live' })).errors).toHaveLength(0)
    expect((await check(CreateCameraDto, { ...valid, url: 'javascript:alert(1)' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, url: 'ftp://cameras.exemplo.com.br' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, url: 'cameras.exemplo.com.br' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, url: '<iframe src="https://x.com"></iframe>' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, url: `https://exemplo.com/${'a'.repeat(2048)}` })).errors.length).toBeGreaterThan(0)
  })
})

describe('UpdateCameraDto', () => {
  it('aceita corpo parcial', async () => {
    expect((await check(UpdateCameraDto, { name: 'Pátio' })).errors).toHaveLength(0)
    expect((await check(UpdateCameraDto, { lat: 0, lng: 0 })).errors).toHaveLength(0)
    expect((await check(UpdateCameraDto, {})).errors).toHaveLength(0)
  })

  it('null limpa o endereço, mas não apaga nome nem coordenada', async () => {
    expect((await check(UpdateCameraDto, { url: null })).errors).toHaveLength(0)
    expect((await check(UpdateCameraDto, { name: null })).errors.length).toBeGreaterThan(0)
    expect((await check(UpdateCameraDto, { lat: null })).errors.length).toBeGreaterThan(0)
    expect((await check(UpdateCameraDto, { lng: null })).errors.length).toBeGreaterThan(0)
  })

  it('valida os mesmos limites do cadastro', async () => {
    expect((await check(UpdateCameraDto, { name: ' ' })).errors.length).toBeGreaterThan(0)
    expect((await check(UpdateCameraDto, { lat: 91 })).errors.length).toBeGreaterThan(0)
    expect((await check(UpdateCameraDto, { url: 'javascript:alert(1)' })).errors.length).toBeGreaterThan(0)
  })
})
