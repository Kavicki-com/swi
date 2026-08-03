import { allowedTypesFor, isContentTypeAllowed } from './allowed-content-types'

describe('isContentTypeAllowed', () => {
  it('aceita imagem em qualquer prefixo', () => {
    for (const p of ['reports', 'task', 'chat', 'order', 'avatars', 'exams']) {
      expect(isContentTypeAllowed('image/jpeg', p)).toBe(true)
      expect(isContentTypeAllowed('image/png', p)).toBe(true)
    }
  })

  // O ponto do PR: documento SÓ em exams.
  it('aceita pdf e txt apenas em exams', () => {
    expect(isContentTypeAllowed('application/pdf', 'exams')).toBe(true)
    expect(isContentTypeAllowed('text/plain', 'exams')).toBe(true)
    for (const p of ['reports', 'task', 'chat', 'order', 'avatars']) {
      expect(isContentTypeAllowed('application/pdf', p)).toBe(false)
      expect(isContentTypeAllowed('text/plain', p)).toBe(false)
    }
  })

  it('recusa tipo desconhecido em qualquer prefixo', () => {
    expect(isContentTypeAllowed('application/x-msdownload', 'exams')).toBe(false)
    expect(isContentTypeAllowed('', 'exams')).toBe(false)
  })

  // prefix ausente cai no default 'reports' (mesmo default do presignPut).
  it('trata prefix indefinido como reports', () => {
    expect(isContentTypeAllowed('image/png', undefined)).toBe(true)
    expect(isContentTypeAllowed('application/pdf', undefined)).toBe(false)
  })

  // Content-type com parâmetro é RECUSADO de propósito. Não normalizar é
  // deliberado: o content-type entra na ASSINATURA do presign, então aceitar
  // 'text/plain; charset=utf-8' aqui e assinar 'text/plain' faria o header do
  // PUT divergir do assinado, e o storage responderia 403. Recusar cedo dá erro
  // legível; normalizar daria um 403 opaco depois do upload inteiro.
  it('recusa content-type com parâmetro, em vez de normalizar', () => {
    expect(isContentTypeAllowed('text/plain; charset=utf-8', 'exams')).toBe(false)
  })
})

// Esta lista vira texto na mensagem do 400 do presignPut. Ela mora aqui, e não
// numa string montada no service, pra mensagem e regra não dessincronizarem: o
// usuário que tomou o 400 precisa ler exatamente o que passaria.
describe('allowedTypesFor', () => {
  it('exams acrescenta os tipos de documento às imagens', () => {
    expect(allowedTypesFor('exams')).toEqual([
      'image/jpeg',
      'image/png',
      'application/pdf',
      'text/plain',
    ])
  })

  it('demais prefixos ficam só nas imagens, prefix ausente incluso', () => {
    expect(allowedTypesFor('chat')).toEqual(['image/jpeg', 'image/png'])
    expect(allowedTypesFor(undefined)).toEqual(['image/jpeg', 'image/png'])
  })

  // Trava a fonte única: o que a mensagem lista é o que o allow/deny aceita.
  it('tudo que ela lista passa no isContentTypeAllowed', () => {
    for (const prefix of ['reports', 'task', 'chat', 'order', 'avatars', 'exams']) {
      for (const type of allowedTypesFor(prefix)) {
        expect(isContentTypeAllowed(type, prefix)).toBe(true)
      }
    }
  })
})
