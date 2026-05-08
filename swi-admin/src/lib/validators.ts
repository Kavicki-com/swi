const EMAIL_RE = /^[^\s@.]+(?:\.[^\s@.]+)*@[^\s@.]+(?:\.[^\s@.]+)+$/

export const isEmail = (value: string): boolean => EMAIL_RE.test(value)

export const minLength = (value: string, n: number): boolean => value.length >= n

export const requiredText = (value: string): boolean => value.trim().length > 0

export const matches = (a: string, b: string): boolean => a === b
