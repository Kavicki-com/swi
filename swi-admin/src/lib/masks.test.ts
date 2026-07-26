// vitest globals (describe/it/expect) via globals: true — importar de 'vitest'
// duplicaria a instância e quebraria o registro do suite (ver weather.test.ts).
import { maskCep, maskCnpj, maskCpf, maskDate, maskPhone, onlyDigits } from './masks'

describe('onlyDigits', () => {
  it('remove tudo que não é dígito', () => {
    expect(onlyDigits('123.456.789-09')).toBe('12345678909')
    expect(onlyDigits('(11) 98765-4321')).toBe('11987654321')
    expect(onlyDigits('abc')).toBe('')
  })
})

describe('maskCpf', () => {
  it('formata progressivamente enquanto o usuário digita', () => {
    expect(maskCpf('1')).toBe('1')
    expect(maskCpf('123')).toBe('123')
    expect(maskCpf('1234')).toBe('123.4')
    expect(maskCpf('1234567')).toBe('123.456.7')
    expect(maskCpf('123456789')).toBe('123.456.789')
    expect(maskCpf('12345678909')).toBe('123.456.789-09')
  })

  it('ignora excesso de dígitos e é idempotente sobre valor já mascarado', () => {
    expect(maskCpf('123456789091111')).toBe('123.456.789-09')
    expect(maskCpf('123.456.789-09')).toBe('123.456.789-09')
  })

  it('vazio continua vazio (não inventa pontuação)', () => {
    expect(maskCpf('')).toBe('')
  })
})

describe('maskPhone', () => {
  it('celular com 11 dígitos: (00) 00000-0000', () => {
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321')
  })

  it('fixo com 10 dígitos: (00) 0000-0000', () => {
    expect(maskPhone('1133334444')).toBe('(11) 3333-4444')
  })

  it('formata progressivamente e ignora excesso', () => {
    expect(maskPhone('1')).toBe('(1')
    expect(maskPhone('11')).toBe('(11')
    expect(maskPhone('119')).toBe('(11) 9')
    expect(maskPhone('119876543219999')).toBe('(11) 98765-4321')
  })

  it('idempotente sobre valor já mascarado', () => {
    expect(maskPhone('(11) 98765-4321')).toBe('(11) 98765-4321')
  })
})

describe('maskCep', () => {
  it('formata 00000-000 e ignora excesso', () => {
    expect(maskCep('01310')).toBe('01310')
    expect(maskCep('01310930')).toBe('01310-930')
    expect(maskCep('013109309999')).toBe('01310-930')
  })

  it('idempotente', () => {
    expect(maskCep('01310-930')).toBe('01310-930')
  })
})

describe('maskDate', () => {
  it('formata DD/MM/AAAA progressivamente', () => {
    expect(maskDate('0')).toBe('0')
    expect(maskDate('04')).toBe('04')
    expect(maskDate('0405')).toBe('04/05')
    expect(maskDate('04051990')).toBe('04/05/1990')
  })

  it('ignora excesso e é idempotente', () => {
    expect(maskDate('040519901111')).toBe('04/05/1990')
    expect(maskDate('04/05/1990')).toBe('04/05/1990')
  })
})

describe('maskCnpj', () => {
  it('formata 00.000.000/0000-00', () => {
    expect(maskCnpj('00000000000191')).toBe('00.000.000/0001-91')
  })

  it('formata progressivamente e é idempotente', () => {
    expect(maskCnpj('00000')).toBe('00.000')
    expect(maskCnpj('00.000.000/0001-91')).toBe('00.000.000/0001-91')
  })
})
