import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateUserDto, UpdateUserDto } from './dto'

const valid = async <T extends object>(cls: new () => T, body: Record<string, unknown>) => {
  const dto = plainToInstance(cls, body)
  const errors = await validate(dto, { whitelist: true })
  return { dto, errors }
}

// O UpdateUserDto é a porta do PATCH /users/:id. Duas famílias de garantia:
// (1) null explícito não pode atravessar campo não-anulável, porque
// @IsOptional() pula a validação pra null, não só pra undefined; (2) os campos
// de perfil validam IGUAL ao UpdateProfileDto: dois DTOs escrevendo na mesma
// tabela com réguas diferentes é como o painel salva o que o app rejeita.
describe('UpdateUserDto', () => {
  it('name: null explícito é rejeitado (coluna não-anulável, viraria 500 no Prisma)', async () => {
    const { errors } = await valid(UpdateUserDto, { name: null })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('active: null explícito é rejeitado', async () => {
    const { errors } = await valid(UpdateUserDto, { active: null })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('name ausente segue válido (patch parcial)', async () => {
    const { errors } = await valid(UpdateUserDto, { phone: '11 99999-0000' })
    expect(errors).toHaveLength(0)
  })

  // Paridade com o UpdateProfileDto, que usa IsCalendarDate: datetime com fuso
  // deslocaria o dia no @db.Date, e dia inexistente viraria Invalid Date + 500.
  it('birthDate: datetime com offset é rejeitado', async () => {
    const { errors } = await valid(UpdateUserDto, { birthDate: '1990-05-10T22:00:00-03:00' })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('birthDate: dia inexistente no calendário é rejeitado', async () => {
    const { errors } = await valid(UpdateUserDto, { birthDate: '2019-02-30' })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('birthDate: data de calendário válida passa', async () => {
    const { errors } = await valid(UpdateUserDto, { birthDate: '1990-05-04' })
    expect(errors).toHaveLength(0)
  })

  // Max 260 em paridade com profile/dto.ts: com 280 aqui, o painel salvava uma
  // altura que o worker nunca mais conseguia re-salvar no próprio settings.
  it('heightCm: 275 é rejeitado (mesma régua do UpdateProfileDto)', async () => {
    const { errors } = await valid(UpdateUserDto, { heightCm: 275 })
    expect(errors.length).toBeGreaterThan(0)
  })

  it('heightCm: 180 passa', async () => {
    const { errors } = await valid(UpdateUserDto, { heightCm: 180 })
    expect(errors).toHaveLength(0)
  })

  // Sem os campos de endereço a whitelist os descartaria em silêncio e o form
  // de edição futuro "salvaria" endereço num no-op.
  it('aceita os campos de endereço que o Profile expõe', async () => {
    const { dto, errors } = await valid(UpdateUserDto, {
      cep: '01310-100',
      street: 'Av. Paulista',
      number: '1000',
      complement: 'Bloco B',
      neighborhood: 'Bela Vista',
      city: 'São Paulo',
      uf: 'SP',
    })
    expect(errors).toHaveLength(0)
    expect(dto).toEqual(expect.objectContaining({ cep: '01310-100', uf: 'SP' }))
  })

  it('uf com tamanho errado é rejeitado', async () => {
    const { errors } = await valid(UpdateUserDto, { uf: 'SAO' })
    expect(errors.length).toBeGreaterThan(0)
  })
})

// O cadastro pelo painel renderiza "Dados de saúde" e o CreateUserDto os
// descartava por whitelist: o buraco original da auditoria mora AQUI, no
// create, não no patch.
describe('CreateUserDto', () => {
  const base = { name: 'Ana', email: 'ana@empresa.com.br', password: 'senha-forte', role: 'WORKER' }

  it('aceita os dados de saúde declaratórios do cadastro', async () => {
    const { dto, errors } = await valid(CreateUserDto, {
      ...base,
      gender: 'Feminino',
      bloodType: 'O-',
      allergies: 'Dipirona',
      chronicConditions: 'Asma',
    })
    expect(errors).toHaveLength(0)
    expect(dto).toEqual(
      expect.objectContaining({ gender: 'Feminino', bloodType: 'O-', allergies: 'Dipirona', chronicConditions: 'Asma' }),
    )
  })

  it('birthDate do create usa a mesma régua de calendário', async () => {
    const { errors } = await valid(CreateUserDto, { ...base, birthDate: '2019-02-30' })
    expect(errors.length).toBeGreaterThan(0)
  })
})
