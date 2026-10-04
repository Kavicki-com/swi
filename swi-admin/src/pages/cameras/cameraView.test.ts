import { cameraViewOf } from './cameraView'

describe('cameraViewOf', () => {
  it('sem endereço não há o que mostrar', () => {
    expect(cameraViewOf(null)).toEqual({ kind: 'none' })
    expect(cameraViewOf('')).toEqual({ kind: 'none' })
  })

  it('https abre dentro do painel', () => {
    expect(cameraViewOf('https://cameras.exemplo.com.br/portaria')).toEqual({
      kind: 'embed',
      url: 'https://cameras.exemplo.com.br/portaria',
    })
  })

  it('http só abre em nova aba: o navegador bloqueia http dentro de página https', () => {
    expect(cameraViewOf('http://192.168.0.10:8080/live')).toEqual({
      kind: 'link',
      url: 'http://192.168.0.10:8080/live',
      reason: 'http',
    })
  })

  it('endereço na origem do painel ou da API só abre em nova aba', () => {
    // Embutido com allow-same-origin, uma página da mesma origem leria a
    // sessão do painel e poderia desfazer o isolamento do quadro.
    const protegidas = ['https://painel.exemplo.com.br', 'https://api.exemplo.com.br']
    expect(cameraViewOf('https://painel.exemplo.com.br/qualquer', protegidas)).toEqual({
      kind: 'link',
      url: 'https://painel.exemplo.com.br/qualquer',
      reason: 'protected-origin',
    })
    // http numa origem protegida continua sendo, antes de tudo, http.
    expect(
      cameraViewOf('http://painel.exemplo.com.br/x', ['http://painel.exemplo.com.br']),
    ).toEqual({
      kind: 'link',
      url: 'http://painel.exemplo.com.br/x',
      reason: 'http',
    })
    expect(cameraViewOf('https://api.exemplo.com.br/x', protegidas).kind).toBe('link')
    expect(cameraViewOf('https://cameras.exemplo.com.br/x', protegidas).kind).toBe('embed')
  })

  it('endereço incompleto não vira link nem quadro', () => {
    expect(cameraViewOf('https://')).toEqual({ kind: 'none' })
  })

  it('qualquer outro esquema não vira link nem quadro', () => {
    expect(cameraViewOf('javascript:alert(1)')).toEqual({ kind: 'none' })
    expect(cameraViewOf('data:text/html,<b>x</b>')).toEqual({ kind: 'none' })
    expect(cameraViewOf('não é endereço')).toEqual({ kind: 'none' })
  })
})
