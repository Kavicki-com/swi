import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'
import { CreateRescueDto } from './dto'

const check = (body: Record<string, unknown>) => {
  const dto = plainToInstance(CreateRescueDto, body)
  return validate(dto, { whitelist: true }).then((errors) => ({ dto, errors }))
}

describe('CreateRescueDto', () => {
  it('aceita o id do socorrista', async () => {
    expect((await check({ rescuerId: 'socorrista-1' })).errors).toHaveLength(0)
  })

  it('apara o id colado com espaço', async () => {
    const { dto, errors } = await check({ rescuerId: '  socorrista-1  ' })
    expect(errors).toHaveLength(0)
    expect(dto.rescuerId).toBe('socorrista-1')
  })

  it('rejeita id ausente, vazio ou que não é texto', async () => {
    expect((await check({})).errors.length).toBeGreaterThan(0)
    expect((await check({ rescuerId: '   ' })).errors.length).toBeGreaterThan(0)
    expect((await check({ rescuerId: 42 })).errors.length).toBeGreaterThan(0)
  })
})
