import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateCameraDto, UpdateCameraDto, embedAllowedHosts, isEmbedUrlAllowed } from './dto'

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

// O player por iframe é separado do endereço: o painel embute esta origem na
// própria página, então ela entra só se o domínio estiver na lista liberada
// por CAMERA_EMBED_ALLOWED_HOSTS. Lista vazia recusa tudo, que é o padrão.
describe('embedAllowedHosts', () => {
  it('quebra por vírgula, apara, ignora vazios e normaliza a caixa', () => {
    expect([...embedAllowedHosts(' Player.Exemplo.com.br , cftv.exemplo.com ,, ')]).toEqual([
      'player.exemplo.com.br',
      'cftv.exemplo.com',
    ])
    expect(embedAllowedHosts('').size).toBe(0)
    expect(embedAllowedHosts(undefined).size).toBe(0)
  })
})

describe('isEmbedUrlAllowed', () => {
  const hosts = new Set(['player.exemplo.com.br'])

  it('exige string, https, host exato e lista não vazia', () => {
    expect(isEmbedUrlAllowed('https://player.exemplo.com.br/cam/1', hosts)).toBe(true)
    expect(isEmbedUrlAllowed('https://PLAYER.exemplo.com.br/cam/1', hosts)).toBe(true)
    expect(isEmbedUrlAllowed(42, hosts)).toBe(false)
    expect(isEmbedUrlAllowed('não é endereço', hosts)).toBe(false)
    expect(isEmbedUrlAllowed('http://player.exemplo.com.br/cam/1', hosts)).toBe(false)
    expect(isEmbedUrlAllowed('https://player.exemplo.com.br/cam/1', new Set())).toBe(false)
  })

  it('casa o host inteiro: nem domínio de fora nem sufixo enganoso entram', () => {
    expect(isEmbedUrlAllowed('https://outro.com/cam', hosts)).toBe(false)
    expect(isEmbedUrlAllowed('https://player.exemplo.com.br.evil.com/cam', hosts)).toBe(false)
    expect(isEmbedUrlAllowed('https://exemplo.com.br/cam', hosts)).toBe(false)
  })

  it('"*.dominio" libera o domínio e os subdomínios, sem sufixo enganoso', () => {
    const wild = new Set(['*.youtube.com'])
    expect(isEmbedUrlAllowed('https://www.youtube.com/embed/abc', wild)).toBe(true)
    expect(isEmbedUrlAllowed('https://youtube.com/embed/abc', wild)).toBe(true)
    expect(isEmbedUrlAllowed('https://m.www.youtube.com/embed/abc', wild)).toBe(true)
    expect(isEmbedUrlAllowed('https://evilyoutube.com/embed/abc', wild)).toBe(false)
    expect(isEmbedUrlAllowed('https://www.youtube.com.evil.com/embed/abc', wild)).toBe(false)
    expect(isEmbedUrlAllowed('http://www.youtube.com/embed/abc', wild)).toBe(false)
  })

  it('"*" libera qualquer domínio, mas segue exigindo https', () => {
    const any = new Set(['*'])
    expect(isEmbedUrlAllowed('https://player.twitch.tv/?channel=x&parent=swi.kavicki.com', any)).toBe(true)
    expect(isEmbedUrlAllowed('https://cftv.obra.com.br/cam/1', any)).toBe(true)
    expect(isEmbedUrlAllowed('http://cftv.obra.com.br/cam/1', any)).toBe(false)
    expect(isEmbedUrlAllowed('javascript:alert(1)', any)).toBe(false)
    expect(isEmbedUrlAllowed('não é endereço', any)).toBe(false)
  })
})

describe('embedUrl no DTO', () => {
  const saved = process.env.CAMERA_EMBED_ALLOWED_HOSTS
  afterEach(() => {
    if (saved === undefined) delete process.env.CAMERA_EMBED_ALLOWED_HOSTS
    else process.env.CAMERA_EMBED_ALLOWED_HOSTS = saved
  })

  it('lista vazia recusa qualquer player: o padrão seguro é não embutir nada', async () => {
    delete process.env.CAMERA_EMBED_ALLOWED_HOSTS
    expect(
      (await check(CreateCameraDto, { ...valid, embedUrl: 'https://player.exemplo.com.br/cam/1' })).errors.length,
    ).toBeGreaterThan(0)
    process.env.CAMERA_EMBED_ALLOWED_HOSTS = ''
    expect(
      (await check(CreateCameraDto, { ...valid, embedUrl: 'https://player.exemplo.com.br/cam/1' })).errors.length,
    ).toBeGreaterThan(0)
  })

  it('aceita https de domínio liberado e apara o espaço colado', async () => {
    process.env.CAMERA_EMBED_ALLOWED_HOSTS = 'player.exemplo.com.br, cftv.exemplo.com'
    const { dto, errors } = await check(CreateCameraDto, {
      ...valid,
      embedUrl: '  https://player.exemplo.com.br/cam/1  ',
    })
    expect(errors).toHaveLength(0)
    expect(dto.embedUrl).toBe('https://player.exemplo.com.br/cam/1')
  })

  it('recusa domínio fora da lista, http e trecho de iframe colado', async () => {
    process.env.CAMERA_EMBED_ALLOWED_HOSTS = 'player.exemplo.com.br'
    expect((await check(CreateCameraDto, { ...valid, embedUrl: 'https://outro.com/cam' })).errors.length).toBeGreaterThan(0)
    expect((await check(CreateCameraDto, { ...valid, embedUrl: 'http://player.exemplo.com.br/cam' })).errors.length).toBeGreaterThan(0)
    expect(
      (await check(CreateCameraDto, { ...valid, embedUrl: '<iframe src="https://player.exemplo.com.br/cam"></iframe>' })).errors.length,
    ).toBeGreaterThan(0)
  })

  it('recusa endereço longo demais', async () => {
    process.env.CAMERA_EMBED_ALLOWED_HOSTS = 'player.exemplo.com.br'
    expect(
      (await check(CreateCameraDto, { ...valid, embedUrl: `https://player.exemplo.com.br/${'a'.repeat(2048)}` })).errors.length,
    ).toBeGreaterThan(0)
  })

  it('null limpa o player; ausente é aceito, inclusive na edição parcial', async () => {
    process.env.CAMERA_EMBED_ALLOWED_HOSTS = 'player.exemplo.com.br'
    expect((await check(CreateCameraDto, { ...valid, embedUrl: null })).errors).toHaveLength(0)
    expect((await check(UpdateCameraDto, { embedUrl: null })).errors).toHaveLength(0)
    expect((await check(UpdateCameraDto, { embedUrl: 'https://player.exemplo.com.br/cam' })).errors).toHaveLength(0)
  })
})
