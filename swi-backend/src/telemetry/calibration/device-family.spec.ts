import { dominantFamily, familyOfDeviceKind } from './device-family'

describe('família do aparelho', () => {
  it('relógio e pulseira; o resto não calibra', () => {
    expect(familyOfDeviceKind('APPLE_WATCH')).toBe('WATCH')
    expect(familyOfDeviceKind('ANDROID_PHONE')).toBe('BAND')
    expect(familyOfDeviceKind('IPHONE')).toBeNull()
    expect(familyOfDeviceKind('EXTERNAL_CUFF')).toBeNull()
  })
  it('a do dia é a que mais leu batimento; empate fica com o relógio', () => {
    expect(dominantFamily(['BAND', 'WATCH', 'BAND'])).toBe('BAND')
    expect(dominantFamily(['BAND', 'WATCH'])).toBe('WATCH')
    expect(dominantFamily([null, null])).toBeNull()
    expect(dominantFamily([])).toBeNull()
  })
})
