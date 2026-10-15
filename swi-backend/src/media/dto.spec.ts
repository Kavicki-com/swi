import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { PresignDto } from './dto'

const MB = 1024 * 1024

const lengthErrors = async (body: Record<string, unknown>) => {
  const errors = await validate(plainToInstance(PresignDto, body))
  return errors.filter((e) => e.property === 'contentLength')
}

// O teto do contentLength depende do contentType: vídeo vai a 100 MB, áudio a
// 25 MB, imagem e PDF ficam nos 15 MB. O DTO devolve 400 legível antes de o
// service ser chamado; o service repete a regra porque pode ser chamado direto.
describe('PresignDto.contentLength', () => {
  it.each([
    ['video/mp4', 100 * MB],
    ['audio/mpeg', 25 * MB],
    ['image/jpeg', 15 * MB],
    ['application/pdf', 15 * MB],
  ])('%s aceita exatamente o teto do tipo', async (contentType, contentLength) => {
    expect(await lengthErrors({ contentType, contentLength, prefix: 'reports' })).toHaveLength(0)
  })

  it.each([
    ['video/mp4', 100 * MB + 1],
    ['audio/mpeg', 25 * MB + 1],
    ['image/jpeg', 15 * MB + 1],
    ['application/pdf', 15 * MB + 1],
  ])('%s recusa um byte acima do teto do tipo', async (contentType, contentLength) => {
    expect(await lengthErrors({ contentType, contentLength, prefix: 'reports' })).not.toHaveLength(0)
  })

  // Sem o cruzamento com o tipo, o teto do vídeo valeria para imagem também.
  it('imagem de 50 MB é recusada mesmo cabendo no teto do vídeo', async () => {
    expect(await lengthErrors({ contentType: 'image/png', contentLength: 50 * MB })).not.toHaveLength(0)
  })

  it('recusa zero e não inteiro', async () => {
    expect(await lengthErrors({ contentType: 'image/png', contentLength: 0 })).not.toHaveLength(0)
    expect(await lengthErrors({ contentType: 'image/png', contentLength: 1.5 })).not.toHaveLength(0)
  })
})
