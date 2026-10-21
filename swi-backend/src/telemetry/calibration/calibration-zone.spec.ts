import { worseZone, zoneOf } from './calibration-zone'

// A zona é o que o painel pinta em cima do valor atual: onde a leitura cai na
// faixa da pessoa. O que se protege aqui é a borda: valor igual ao corte cai
// do lado que a regra manda, e corte ausente nunca inventa zona.

describe('zoneOf', () => {
  it('sem valor ou sem corte não há zona', () => {
    expect(zoneOf('HEART_RATE', null, { excellence: 70, fatigue: 140 })).toBeNull()
    expect(zoneOf('HEART_RATE', 90, null)).toBeNull()
  })

  describe('quanto maior, pior (batimento, pressão, esforço, desgaste)', () => {
    const cuts = { excellence: 70, fatigue: 140 }

    it('fadiga a partir do corte de fadiga, inclusive', () => {
      expect(zoneOf('HEART_RATE', 140, cuts)).toBe('FATIGUE')
      expect(zoneOf('HEART_RATE', 150, cuts)).toBe('FATIGUE')
      expect(zoneOf('HEART_RATE', 139.9, cuts)).toBe('NORMAL')
    })

    it('excelência até o corte de excelência, inclusive', () => {
      expect(zoneOf('HEART_RATE', 70, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('HEART_RATE', 55, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('HEART_RATE', 70.1, cuts)).toBe('NORMAL')
    })

    it('vale para as cinco medições', () => {
      expect(zoneOf('SYSTOLIC', 140, cuts)).toBe('FATIGUE')
      expect(zoneOf('DIASTOLIC', 60, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('EFFORT', 100, cuts)).toBe('NORMAL')
      expect(zoneOf('WEAR', 80, { excellence: 30, fatigue: 80 })).toBe('FATIGUE')
    })

    it('só com fadiga (partida v1.0), tudo abaixo dela é normal', () => {
      expect(zoneOf('HEART_RATE', 55, { excellence: null, fatigue: 140 })).toBe('NORMAL')
      expect(zoneOf('HEART_RATE', 140, { excellence: null, fatigue: 140 })).toBe('FATIGUE')
    })

    it('só com excelência, tudo acima dela é normal', () => {
      expect(zoneOf('HEART_RATE', 150, { excellence: 70, fatigue: null })).toBe('NORMAL')
      expect(zoneOf('HEART_RATE', 70, { excellence: 70, fatigue: null })).toBe('EXCELLENCE')
    })

    it('com os dois cortes nulos não há zona', () => {
      expect(zoneOf('HEART_RATE', 90, { excellence: null, fatigue: null })).toBeNull()
    })
  })

  describe('oxigenação (quanto menor, pior)', () => {
    const cuts = { excellence: 97, fatigue: 92 }

    it('fadiga abaixo do corte de fadiga; igual ao corte ainda é normal', () => {
      expect(zoneOf('OXYGEN_SATURATION', 91.9, cuts)).toBe('FATIGUE')
      expect(zoneOf('OXYGEN_SATURATION', 92, cuts)).toBe('NORMAL')
    })

    it('excelência a partir do corte de excelência, inclusive', () => {
      expect(zoneOf('OXYGEN_SATURATION', 97, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('OXYGEN_SATURATION', 99, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('OXYGEN_SATURATION', 96.9, cuts)).toBe('NORMAL')
    })

    it('corte ausente desliga só aquela borda; os dois nulos não dão zona', () => {
      expect(zoneOf('OXYGEN_SATURATION', 85, { excellence: 97, fatigue: null })).toBe('NORMAL')
      expect(zoneOf('OXYGEN_SATURATION', 99, { excellence: null, fatigue: 92 })).toBe('NORMAL')
      expect(zoneOf('OXYGEN_SATURATION', 95, { excellence: null, fatigue: null })).toBeNull()
    })
  })

  describe('temperatura (dois lados)', () => {
    const cuts = { p10: 35.8, p25: 36.1, p75: 36.7, p90: 37.1 }

    it('fora de p10..p90 é fadiga; nos cortes ainda não', () => {
      expect(zoneOf('BODY_TEMPERATURE', 35.7, cuts)).toBe('FATIGUE')
      expect(zoneOf('BODY_TEMPERATURE', 37.2, cuts)).toBe('FATIGUE')
      expect(zoneOf('BODY_TEMPERATURE', 35.8, cuts)).toBe('NORMAL')
      expect(zoneOf('BODY_TEMPERATURE', 37.1, cuts)).toBe('NORMAL')
    })

    it('entre p25 e p75, inclusive, é excelência', () => {
      expect(zoneOf('BODY_TEMPERATURE', 36.1, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('BODY_TEMPERATURE', 36.4, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('BODY_TEMPERATURE', 36.7, cuts)).toBe('EXCELLENCE')
      expect(zoneOf('BODY_TEMPERATURE', 36.0, cuts)).toBe('NORMAL')
      expect(zoneOf('BODY_TEMPERATURE', 36.8, cuts)).toBe('NORMAL')
    })

    it('corte ausente desliga só aquela borda', () => {
      // Sem p90 não há fadiga por cima; sem p25 a excelência vai até p10.
      expect(zoneOf('BODY_TEMPERATURE', 39, { ...cuts, p90: null })).toBe('NORMAL')
      expect(zoneOf('BODY_TEMPERATURE', 35.9, { ...cuts, p25: null })).toBe('EXCELLENCE')
      expect(zoneOf('BODY_TEMPERATURE', 35.7, { ...cuts, p25: null })).toBe('FATIGUE')
    })

    it('com os quatro cortes nulos não há zona', () => {
      expect(zoneOf('BODY_TEMPERATURE', 36.5, { p10: null, p25: null, p75: null, p90: null })).toBeNull()
    })
  })

  describe('atividade (passos, distância, calorias, movimento)', () => {
    const cuts = { below: 6000, above: 11000 }

    it('abaixo do habitual, habitual e acima; os cortes são habituais', () => {
      expect(zoneOf('STEPS', 5999, cuts)).toBe('BELOW')
      expect(zoneOf('STEPS', 6000, cuts)).toBe('USUAL')
      expect(zoneOf('STEPS', 11000, cuts)).toBe('USUAL')
      expect(zoneOf('STEPS', 11001, cuts)).toBe('ABOVE')
      expect(zoneOf('DISTANCE', 3000, cuts)).toBe('BELOW')
      expect(zoneOf('ACTIVE_ENERGY', 20000, cuts)).toBe('ABOVE')
      expect(zoneOf('MOVEMENT', 40, { below: 30, above: 55 })).toBe('USUAL')
    })

    it('corte ausente desliga só aquela borda; os dois nulos não dão zona', () => {
      expect(zoneOf('STEPS', 100, { below: null, above: 11000 })).toBe('USUAL')
      expect(zoneOf('STEPS', 20000, { below: 6000, above: null })).toBe('USUAL')
      expect(zoneOf('STEPS', 8000, { below: null, above: null })).toBeNull()
    })
  })
})

describe('worseZone', () => {
  it('fadiga pesa mais que normal, que pesa mais que excelência', () => {
    expect(worseZone('EXCELLENCE', 'NORMAL')).toBe('NORMAL')
    expect(worseZone('NORMAL', 'FATIGUE')).toBe('FATIGUE')
    expect(worseZone('FATIGUE', 'EXCELLENCE')).toBe('FATIGUE')
    expect(worseZone('EXCELLENCE', 'EXCELLENCE')).toBe('EXCELLENCE')
  })

  it('zona ausente é ignorada, não puxa para baixo nem para cima', () => {
    expect(worseZone(null, 'EXCELLENCE')).toBe('EXCELLENCE')
    expect(worseZone('FATIGUE', null)).toBe('FATIGUE')
    expect(worseZone(null, null)).toBeNull()
  })
})
