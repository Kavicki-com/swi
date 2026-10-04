import { Prisma } from '@prisma/client'
import { describeError, isPrismaError, stackFramesOf } from './describe-error'

const SEGREDO = 'heartRate: 187'

const known = (code: string) =>
  new Prisma.PrismaClientKnownRequestError(`Invalid invocation ${SEGREDO}`, { code, clientVersion: 'teste' })

const validation = () =>
  new Prisma.PrismaClientValidationError(`Argument inválido: { ${SEGREDO} }`, { clientVersion: 'teste' })

describe('describeError', () => {
  // A mensagem do Prisma repete os argumentos da chamada, e os argumentos são
  // batimento, posição e alergia. No log só entram o tipo e o código.
  it('erro conhecido do Prisma vira tipo e código, sem a mensagem', () => {
    const text = describeError(known('P2002'))
    expect(text).toBe('PrismaClientKnownRequestError P2002')
    expect(text).not.toContain('187')
  })

  it('erro de validação do Prisma vira só o tipo', () => {
    const text = describeError(validation())
    expect(text).toBe('PrismaClientValidationError')
    expect(text).not.toContain('187')
  })

  it('erro desconhecido do banco vira só o tipo', () => {
    const error = new Prisma.PrismaClientUnknownRequestError(`Failing row contains (${SEGREDO})`, {
      clientVersion: 'teste',
    })
    expect(describeError(error)).toBe('PrismaClientUnknownRequestError')
  })

  it('erro comum mantém a mensagem', () => {
    expect(describeError(new Error('conexão recusada'))).toBe('conexão recusada')
  })

  it('o que não é Error vira texto', () => {
    expect(describeError('falhou')).toBe('falhou')
    expect(describeError(undefined)).toBe('undefined')
  })
})

describe('isPrismaError', () => {
  it('reconhece os erros do Prisma e só eles', () => {
    expect(isPrismaError(known('P2025'))).toBe(true)
    expect(isPrismaError(validation())).toBe(true)
    expect(isPrismaError(new Error('x'))).toBe(false)
    expect(isPrismaError(null)).toBe(false)
  })
})

describe('stackFramesOf', () => {
  // A primeira linha da pilha é a própria mensagem, e a do Prisma tem várias
  // linhas: só os quadros ("at ...") sobram.
  it('devolve só os quadros da pilha', () => {
    const error = new Error(`linha um\nlinha dois ${SEGREDO}`)
    const frames = stackFramesOf(error)
    expect(frames).not.toContain('187')
    expect(frames).not.toContain('linha um')
    expect(frames.split('\n').every((line) => /^\s+at /.test(line))).toBe(true)
    expect(frames.length).toBeGreaterThan(0)
  })

  it('sem pilha devolve vazio', () => {
    const error = new Error('x')
    error.stack = undefined
    expect(stackFramesOf(error)).toBe('')
  })
})
