import { resolveApiUrl } from './apiConfig'

// `true` = build de produção; `false` = dev/teste, onde localhost é legítimo.
const PROD = true
const DEV = false

describe('resolveApiUrl', () => {
  it('exige a variável em produção', () => {
    expect(() => resolveApiUrl(undefined, PROD)).toThrow(/VITE_API_URL/)
    expect(() => resolveApiUrl('', PROD)).toThrow(/VITE_API_URL/)
    expect(() => resolveApiUrl('   ', PROD)).toThrow(/VITE_API_URL/)
  })

  it('recusa a máquina local em produção', () => {
    expect(() => resolveApiUrl('http://localhost:3000', PROD)).toThrow(/produção/)
    expect(() => resolveApiUrl('http://127.0.0.1:3000', PROD)).toThrow(/produção/)
  })

  // URL.hostname devolve '[::1]' COM colchetes. Comparar contra '::1' cru nunca
  // casa, e o loopback IPv6 passa direto: foi assim que o mobile vazou.
  it('recusa o loopback IPv6 com colchetes', () => {
    expect(() => resolveApiUrl('http://[::1]:3000', PROD)).toThrow(/produção/)
  })

  it('recusa URL relativa ou protocolo não suportado', () => {
    expect(() => resolveApiUrl('api.kavicki.com', PROD)).toThrow(/URL absoluta/)
    expect(() => resolveApiUrl('ftp://api.kavicki.com', PROD)).toThrow(/protocolo/)
  })

  it('aceita o endereço público e remove a barra final', () => {
    expect(resolveApiUrl('https://api.kavicki.com', PROD)).toBe('https://api.kavicki.com')
    expect(resolveApiUrl('https://api.kavicki.com/', PROD)).toBe('https://api.kavicki.com')
    expect(resolveApiUrl('https://api.kavicki.com///', PROD)).toBe('https://api.kavicki.com')
  })

  it('em dev aceita localhost e cai no default quando a variável falta', () => {
    expect(resolveApiUrl('http://localhost:3000', DEV)).toBe('http://localhost:3000')
    expect(resolveApiUrl(undefined, DEV)).toBe('http://localhost:3000')
  })
})
