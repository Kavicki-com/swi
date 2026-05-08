import { isEmail, minLength, requiredText, matches } from './validators'

describe('isEmail', () => {
  it('accepts a normal email', () => {
    expect(isEmail('admin@swi.test')).toBe(true)
  })
  it('rejects missing @', () => {
    expect(isEmail('admin.swi.test')).toBe(false)
  })
  it('rejects empty string', () => {
    expect(isEmail('')).toBe(false)
  })
})

describe('minLength', () => {
  it('passes when string has at least N chars', () => {
    expect(minLength('abcdefgh', 8)).toBe(true)
  })
  it('fails when shorter', () => {
    expect(minLength('abc', 8)).toBe(false)
  })
})

describe('requiredText', () => {
  it('rejects empty and whitespace-only', () => {
    expect(requiredText('')).toBe(false)
    expect(requiredText('   ')).toBe(false)
  })
  it('accepts trimmed non-empty', () => {
    expect(requiredText('a')).toBe(true)
  })
})

describe('matches', () => {
  it('returns true when both are equal', () => {
    expect(matches('hunter2', 'hunter2')).toBe(true)
  })
  it('returns false when different', () => {
    expect(matches('hunter2', 'hunter3')).toBe(false)
  })
})
