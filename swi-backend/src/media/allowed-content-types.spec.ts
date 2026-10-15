import {
  MAX_AUDIO_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  allowedTypesFor,
  attachmentKindOf,
  contentTypeOfKey,
  extensionFor,
  isContentTypeAllowed,
  maxBytesFor,
} from './allowed-content-types'

describe('isContentTypeAllowed', () => {
  it('aceita imagem em qualquer prefixo', () => {
    for (const p of ['reports', 'task', 'chat', 'order', 'avatars', 'exams']) {
      expect(isContentTypeAllowed('image/jpeg', p)).toBe(true)
      expect(isContentTypeAllowed('image/png', p)).toBe(true)
    }
  })

  // Documento continua fora de chat, tarefa, ordem e avatar. PDF entra em
  // exams e em reports (anexo multimídia do relatório); txt segue só em exams.
  it('aceita pdf em exams e reports, txt apenas em exams', () => {
    expect(isContentTypeAllowed('application/pdf', 'exams')).toBe(true)
    expect(isContentTypeAllowed('text/plain', 'exams')).toBe(true)
    expect(isContentTypeAllowed('application/pdf', 'reports')).toBe(true)
    expect(isContentTypeAllowed('text/plain', 'reports')).toBe(false)
    for (const p of ['task', 'chat', 'order', 'avatars']) {
      expect(isContentTypeAllowed('application/pdf', p)).toBe(false)
      expect(isContentTypeAllowed('text/plain', p)).toBe(false)
    }
  })

  // Anexo multimídia é exclusivo do relatório: liberar vídeo ou áudio em outro
  // prefixo assinaria upload de até 100 MB num namespace que não consegue
  // referenciar o arquivo depois (lixo de storage).
  const MULTIMIDIA = [
    'video/mp4',
    'video/quicktime',
    'audio/mpeg',
    'audio/mp4',
    'audio/x-m4a',
    'audio/wav',
    'audio/x-wav',
  ]

  it('aceita vídeo e áudio em reports', () => {
    for (const type of MULTIMIDIA) expect(isContentTypeAllowed(type, 'reports')).toBe(true)
  })

  it('recusa vídeo e áudio fora de reports', () => {
    for (const p of ['exams', 'task', 'chat', 'order', 'avatars']) {
      for (const type of MULTIMIDIA) expect(isContentTypeAllowed(type, p)).toBe(false)
    }
  })

  it('recusa tipo desconhecido em qualquer prefixo', () => {
    expect(isContentTypeAllowed('application/x-msdownload', 'exams')).toBe(false)
    expect(isContentTypeAllowed('', 'exams')).toBe(false)
  })

  // prefix ausente cai no default 'reports' (mesmo default do presignPut).
  it('trata prefix indefinido como reports', () => {
    expect(isContentTypeAllowed('image/png', undefined)).toBe(true)
    expect(isContentTypeAllowed('video/mp4', undefined)).toBe(true)
    expect(isContentTypeAllowed('text/plain', undefined)).toBe(false)
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

  it('reports acrescenta vídeo, áudio e pdf às imagens, prefix ausente incluso', () => {
    const esperado = [
      'image/jpeg',
      'image/png',
      'video/mp4',
      'video/quicktime',
      'audio/mpeg',
      'audio/mp4',
      'audio/x-m4a',
      'audio/wav',
      'audio/x-wav',
      'application/pdf',
    ]
    expect(allowedTypesFor('reports')).toEqual(esperado)
    expect(allowedTypesFor(undefined)).toEqual(esperado)
  })

  it('demais prefixos ficam só nas imagens', () => {
    for (const p of ['task', 'chat', 'order', 'avatars']) {
      expect(allowedTypesFor(p)).toEqual(['image/jpeg', 'image/png'])
    }
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

// Teto por tipo. Imagem e documento seguem nos 15 MB de sempre; vídeo e áudio
// têm teto próprio porque um vídeo de celular de um minuto já passa de 15 MB.
describe('maxBytesFor', () => {
  it('imagem e documento ficam em 15 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024)
    for (const t of ['image/jpeg', 'image/png', 'application/pdf', 'text/plain']) {
      expect(maxBytesFor(t)).toBe(MAX_UPLOAD_BYTES)
    }
  })

  it('vídeo vai a 100 MB e áudio a 25 MB', () => {
    expect(MAX_VIDEO_BYTES).toBe(100 * 1024 * 1024)
    expect(MAX_AUDIO_BYTES).toBe(25 * 1024 * 1024)
    expect(maxBytesFor('video/mp4')).toBe(MAX_VIDEO_BYTES)
    expect(maxBytesFor('video/quicktime')).toBe(MAX_VIDEO_BYTES)
    for (const t of ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav']) {
      expect(maxBytesFor(t)).toBe(MAX_AUDIO_BYTES)
    }
  })

  // Tipo desconhecido não ganha teto maior por acidente: cai no menor.
  it('tipo desconhecido cai no teto padrão', () => {
    expect(maxBytesFor('application/x-msdownload')).toBe(MAX_UPLOAD_BYTES)
  })
})

describe('extensão da key e caminho de volta', () => {
  it.each([
    ['image/jpeg', 'jpg'],
    ['image/png', 'png'],
    ['video/mp4', 'mp4'],
    ['video/quicktime', 'mov'],
    ['audio/mpeg', 'mp3'],
    ['audio/mp4', 'm4a'],
    ['audio/x-m4a', 'm4a'],
    ['audio/wav', 'wav'],
    ['audio/x-wav', 'wav'],
    ['application/pdf', 'pdf'],
    ['text/plain', 'txt'],
  ])('%s grava .%s', (contentType, ext) => {
    expect(extensionFor(contentType)).toBe(ext)
  })

  // A leitura do relatório devolve o tipo de cada anexo derivado da extensão
  // da key, já que o banco guarda só a key. Aliases (x-m4a, x-wav) voltam no
  // nome canônico: é ele que o player do painel e do app entende.
  it.each([
    ['reports/a.jpg', 'image/jpeg'],
    ['reports/a.png', 'image/png'],
    ['reports/a.mp4', 'video/mp4'],
    ['reports/a.mov', 'video/quicktime'],
    ['reports/a.mp3', 'audio/mpeg'],
    ['reports/a.m4a', 'audio/mp4'],
    ['reports/a.wav', 'audio/wav'],
    ['reports/a.pdf', 'application/pdf'],
  ])('%s volta como %s', (key, contentType) => {
    expect(contentTypeOfKey(key)).toBe(contentType)
  })

  // Key legada ou fora do padrão não derruba a leitura do relatório.
  it('extensão desconhecida volta como octet-stream', () => {
    expect(contentTypeOfKey('reports/a.exe')).toBe('application/octet-stream')
    expect(contentTypeOfKey('reports/sem-extensao')).toBe('application/octet-stream')
  })
})

describe('attachmentKindOf', () => {
  it.each([
    ['image/jpeg', 'image'],
    ['image/png', 'image'],
    ['video/mp4', 'video'],
    ['video/quicktime', 'video'],
    ['audio/mpeg', 'audio'],
    ['audio/wav', 'audio'],
    ['application/pdf', 'document'],
    ['application/octet-stream', 'document'],
  ])('%s é %s', (contentType, kind) => {
    expect(attachmentKindOf(contentType)).toBe(kind)
  })
})
