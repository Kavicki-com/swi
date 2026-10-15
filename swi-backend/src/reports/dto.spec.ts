import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CreateReportDto, UpdateReportDto } from './dto'
import { allowedTypesFor, extensionFor } from '../media/allowed-content-types'

const UUID = '123e4567-e89b-12d3-a456-426614174000'

// Anexo multimídia: imageKeys (nome mantido pra não quebrar o app instalado)
// passa a aceitar vídeo, áudio e PDF, sempre sob reports/. O regex do DTO é
// literal (o Swagger publica o texto do decorator), então a lista `aceitas`
// sai do presign: liberar um tipo lá sem o DTO aceitar a key deixaria o upload
// subir e o relatório recusá-lo, e este teste quebra.
describe('imageKeys do relatório', () => {
  const keyErrs = async (Dto: new () => object, field: string, keys: string[]) => {
    const body = { title: 'X', [field]: keys }
    const errs = await validate(plainToInstance(Dto, body))
    return errs.filter((e) => e.property === field).length
  }

  const aceitas = allowedTypesFor('reports').map((type) => `reports/${UUID}.${extensionFor(type)}`)

  it.each([
    [CreateReportDto, 'imageKeys'],
    [UpdateReportDto, 'imageKeys'],
    [UpdateReportDto, 'imageKeysBase'],
  ] as const)('%p.%s aceita imagem, vídeo, áudio e pdf', async (Dto, field) => {
    expect(await keyErrs(Dto, field, aceitas)).toBe(0)
  })

  it.each([
    [CreateReportDto, 'imageKeys'],
    [UpdateReportDto, 'imageKeys'],
    [UpdateReportDto, 'imageKeysBase'],
  ] as const)('%p.%s recusa txt e key de outro prefixo', async (Dto, field) => {
    expect(await keyErrs(Dto, field, [`reports/${UUID}.txt`])).toBeGreaterThan(0)
    expect(await keyErrs(Dto, field, [`chat/${UUID}.mp4`])).toBeGreaterThan(0)
    expect(await keyErrs(Dto, field, [`reports/${UUID}.mp4.exe`])).toBeGreaterThan(0)
  })
})

const titleErrs = async (body: object) => {
  const errs = await validate(plainToInstance(UpdateReportDto, body))
  return errs.filter((e) => e.property === 'title').length
}

describe('UpdateReportDto', () => {
  it('rejeita title vazio (coluna obrigatória não pode ser apagada)', async () => {
    expect(await titleErrs({ title: '' })).toBeGreaterThan(0)
  })
  it('aceita title preenchido', async () => {
    expect(await titleErrs({ title: 'X' })).toBe(0)
  })
  it('aceita ausência de title (patch parcial)', async () => {
    expect(await titleErrs({})).toBe(0)
  })
})
