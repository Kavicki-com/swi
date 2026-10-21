import { defaultSafetyLabel, defaultSafetyValues, safetyValuesOf, validateSafety } from './safety-limits'

// As travas são o piso de proteção que não aprende, e só o admin as muda. O
// que estes casos protegem é a leitura desconfiada do JSON gravado e a recusa
// de valor implausível, que a rota de correção devolve como erro.

describe('safetyValuesOf', () => {
  it('lê abre e fecha das travas de um número', () => {
    expect(safetyValuesOf('HEART_RATE_HIGH', { openAt: 175, closeAt: 165 })).toEqual({ openAt: 175, closeAt: 165 })
    expect(safetyValuesOf('OXYGEN_LOW', { openAt: 88, closeAt: 91 })).toEqual({ openAt: 88, closeAt: 91 })
  })

  it('lê os quatro números da pressão', () => {
    const values = { systolicAt: 170, diastolicAt: 105, systolicRecoverBelow: 150, diastolicRecoverBelow: 95 }
    expect(safetyValuesOf('BLOOD_PRESSURE_HIGH', values)).toEqual(values)
  })

  it('ignora campo a mais e devolve só os da regra', () => {
    expect(safetyValuesOf('WEAR_HIGH', { openAt: 85, closeAt: 75, extra: 1 })).toEqual({ openAt: 85, closeAt: 75 })
  })

  it.each([
    ['nulo', null],
    ['texto', 'x'],
    ['lista', [1, 2]],
    ['campo ausente', { openAt: 175 }],
    ['campo não numérico', { openAt: '175', closeAt: 165 }],
    ['campo não finito', { openAt: Number.POSITIVE_INFINITY, closeAt: 165 }],
    ['campo nulo', { openAt: null, closeAt: 165 }],
  ])('JSON torto vira nulo (%s)', (_label, json) => {
    expect(safetyValuesOf('HEART_RATE_HIGH', json)).toBeNull()
  })

  it('pressão sem um dos quatro números vira nulo', () => {
    expect(safetyValuesOf('BLOOD_PRESSURE_HIGH', { systolicAt: 170, diastolicAt: 105, systolicRecoverBelow: 150 })).toBeNull()
    // O formato de um número não serve para a pressão.
    expect(safetyValuesOf('BLOOD_PRESSURE_HIGH', { openAt: 170, closeAt: 150 })).toBeNull()
  })
})

describe('validateSafety', () => {
  it.each([
    ['HEART_RATE_HIGH', { openAt: 100, closeAt: 90 }],
    ['HEART_RATE_HIGH', { openAt: 230, closeAt: 220 }],
    ['HEART_RATE_LOW', { openAt: 30, closeAt: 40 }],
    ['HEART_RATE_LOW', { openAt: 80, closeAt: 90 }],
    ['OXYGEN_LOW', { openAt: 80, closeAt: 100 }],
    ['OXYGEN_LOW', { openAt: 95, closeAt: 97 }],
    ['WEAR_HIGH', { openAt: 50, closeAt: 40 }],
    ['WEAR_HIGH', { openAt: 100, closeAt: 90 }],
  ] as const)('aceita %s dentro da faixa plausível', (rule, values) => {
    expect(validateSafety(rule, values)).toBeNull()
  })

  it.each([
    ['HEART_RATE_HIGH', { openAt: 99, closeAt: 90 }],
    ['HEART_RATE_HIGH', { openAt: 231, closeAt: 220 }],
    ['HEART_RATE_HIGH', { openAt: 170, closeAt: 170 }],
    ['HEART_RATE_LOW', { openAt: 29, closeAt: 40 }],
    ['HEART_RATE_LOW', { openAt: 81, closeAt: 90 }],
    ['HEART_RATE_LOW', { openAt: 45, closeAt: 45 }],
    ['OXYGEN_LOW', { openAt: 79, closeAt: 92 }],
    ['OXYGEN_LOW', { openAt: 96, closeAt: 98 }],
    ['OXYGEN_LOW', { openAt: 90, closeAt: 90 }],
    ['OXYGEN_LOW', { openAt: 90, closeAt: 101 }],
    ['WEAR_HIGH', { openAt: 49, closeAt: 40 }],
    ['WEAR_HIGH', { openAt: 101, closeAt: 90 }],
    ['WEAR_HIGH', { openAt: 85, closeAt: 85 }],
  ] as const)('recusa %s fora da faixa plausível, com o motivo', (rule, values) => {
    expect(validateSafety(rule, values)).toEqual(expect.any(String))
  })

  it('pressão: aceita dentro das faixas e com recuperação abaixo da abertura', () => {
    expect(
      validateSafety('BLOOD_PRESSURE_HIGH', { systolicAt: 140, diastolicAt: 90, systolicRecoverBelow: 130, diastolicRecoverBelow: 85 }),
    ).toBeNull()
    expect(
      validateSafety('BLOOD_PRESSURE_HIGH', { systolicAt: 240, diastolicAt: 140, systolicRecoverBelow: 200, diastolicRecoverBelow: 120 }),
    ).toBeNull()
  })

  it.each([
    [{ systolicAt: 139, diastolicAt: 100, systolicRecoverBelow: 130, diastolicRecoverBelow: 90 }],
    [{ systolicAt: 241, diastolicAt: 100, systolicRecoverBelow: 130, diastolicRecoverBelow: 90 }],
    [{ systolicAt: 180, diastolicAt: 89, systolicRecoverBelow: 160, diastolicRecoverBelow: 80 }],
    [{ systolicAt: 180, diastolicAt: 141, systolicRecoverBelow: 160, diastolicRecoverBelow: 100 }],
    [{ systolicAt: 180, diastolicAt: 110, systolicRecoverBelow: 180, diastolicRecoverBelow: 100 }],
    [{ systolicAt: 180, diastolicAt: 110, systolicRecoverBelow: 160, diastolicRecoverBelow: 110 }],
  ])('pressão: recusa fora da faixa ou recuperação que não fica abaixo (%o)', (values) => {
    expect(validateSafety('BLOOD_PRESSURE_HIGH', values)).toEqual(expect.any(String))
  })

  it('valor do formato errado para a regra é recusado, não aceito por engano', () => {
    expect(validateSafety('BLOOD_PRESSURE_HIGH', { openAt: 180, closeAt: 160 })).toEqual(expect.any(String))
    expect(validateSafety('HEART_RATE_HIGH', { systolicAt: 180 })).toEqual(expect.any(String))
  })
})

describe('defaultSafetyLabel', () => {
  it('descreve o padrão do perfil calibrado em texto, regra a regra', () => {
    expect(defaultSafetyLabel('HEART_RATE_HIGH', { maxBpm: 190 })).toBe('90% da máxima pela idade (171 bpm) por 60 s')
    expect(defaultSafetyLabel('HEART_RATE_LOW', { maxBpm: 190 })).toBe('15 bpm abaixo do repouso, nunca abaixo de 40 bpm')
    expect(defaultSafetyLabel('OXYGEN_LOW', { maxBpm: 190 })).toBe('abaixo de 90%')
    expect(defaultSafetyLabel('BLOOD_PRESSURE_HIGH', { maxBpm: 190 })).toBe('180/110 ou mais')
    expect(defaultSafetyLabel('WEAR_HIGH', { maxBpm: 190 })).toBe('90% ou mais')
  })

  it('batimento alto sem data de nascimento: o piso do perfil, sem falar em idade', () => {
    expect(defaultSafetyLabel('HEART_RATE_HIGH', { maxBpm: null })).toBe('180 bpm por 60 s (sem data de nascimento)')
  })
})

describe('defaultSafetyValues', () => {
  it('batimento pela máxima por idade e pelo repouso, com a histerese do perfil', () => {
    const baseline = { maxBpm: 190, restingBpm: 70 }
    expect(defaultSafetyValues('HEART_RATE_HIGH', baseline)).toEqual({ openAt: 171, closeAt: 161 })
    expect(defaultSafetyValues('HEART_RATE_LOW', baseline)).toEqual({ openAt: 55, closeAt: 65 })
  })

  it('sem idade nem repouso, os pisos do perfil', () => {
    const baseline = { maxBpm: null, restingBpm: null }
    expect(defaultSafetyValues('HEART_RATE_HIGH', baseline)).toEqual({ openAt: 180, closeAt: 170 })
    expect(defaultSafetyValues('HEART_RATE_LOW', baseline)).toEqual({ openAt: 40, closeAt: 50 })
  })

  it('oxigenação, desgaste e pressão saem do perfil calibrado e passam na própria validação', () => {
    const baseline = { maxBpm: null, restingBpm: null }
    expect(defaultSafetyValues('OXYGEN_LOW', baseline)).toEqual({ openAt: 90, closeAt: expect.any(Number) })
    expect(defaultSafetyValues('WEAR_HIGH', baseline)).toEqual({ openAt: 90, closeAt: 80 })
    expect(defaultSafetyValues('BLOOD_PRESSURE_HIGH', baseline)).toMatchObject({ systolicAt: 180, diastolicAt: 110 })
    for (const rule of ['OXYGEN_LOW', 'WEAR_HIGH', 'BLOOD_PRESSURE_HIGH'] as const) {
      expect(validateSafety(rule, defaultSafetyValues(rule, baseline))).toBeNull()
    }
  })
})
