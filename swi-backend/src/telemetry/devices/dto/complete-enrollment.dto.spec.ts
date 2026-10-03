// Os decoradores do DTO precisam do Reflect estendido, como nos outros DTOs.
import 'reflect-metadata'
import { validate } from 'class-validator'
import { plainToInstance } from 'class-transformer'
import { CompleteEnrollmentDto } from './complete-enrollment.dto'

const errosEm = async (body: object) => {
  const errs = await validate(plainToInstance(CompleteEnrollmentDto, body))
  return errs.map((e) => e.property)
}

describe('CompleteEnrollmentDto', () => {
  // O app conclui com o que o administrador dita, e o painel só mostra os seis
  // dígitos: exigir o id do convite recusaria todo pareamento feito pelo app.
  it('aceita só o código, sem o id do convite', async () => {
    expect(await errosEm({ code: '123456' })).toEqual([])
    expect(await errosEm({ code: '123456', model: 'iPhone 15' })).toEqual([])
  })

  it('continua aceitando o id do convite junto do código', async () => {
    expect(await errosEm({ enrollmentId: 'enrollment-1', code: '123456' })).toEqual([])
  })

  it('recusa id do convite que não é texto', async () => {
    expect(await errosEm({ enrollmentId: 42, code: '123456' })).toEqual(['enrollmentId'])
  })

  it.each([undefined, '12345', '1234567', 'abcdef'])('recusa código malformado: %p', async (code) => {
    expect(await errosEm({ code })).toEqual(['code'])
  })
})
