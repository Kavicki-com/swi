import {
  aggregateHeat,
  cellCenter,
  cellOf,
  distanceM,
  HEAT_CELL_SIZE_M,
  latStepDeg,
  SAMPLE_MIN_DISTANCE_M,
  SAMPLE_MIN_INTERVAL_MS,
  selectBackfillSamples,
  shouldRecordSample,
} from './position-history'

const T0 = new Date('2026-10-01T12:00:00.000Z')
const at = (ms: number) => new Date(T0.getTime() + ms)

describe('distanceM', () => {
  it('mede em metros pela superfície da Terra', () => {
    // 0,001 grau de latitude é cerca de 111 m em qualquer longitude.
    expect(distanceM({ lat: -23.55, lng: -46.63 }, { lat: -23.551, lng: -46.63 })).toBeCloseTo(111.2, 0)
    expect(distanceM({ lat: -23.55, lng: -46.63 }, { lat: -23.55, lng: -46.63 })).toBe(0)
  })
})

describe('shouldRecordSample: a trilha guarda movimento, não repetição', () => {
  const last = { lat: -23.55, lng: -46.63, recordedAt: T0 }

  it('primeira posição do funcionário sempre entra', () => {
    expect(shouldRecordSample(null, { lat: -23.55, lng: -46.63 }, T0)).toBe(true)
  })

  it('parado e dentro do intervalo mínimo não grava', () => {
    expect(shouldRecordSample(last, { lat: -23.55, lng: -46.63 }, at(SAMPLE_MIN_INTERVAL_MS - 1))).toBe(false)
  })

  it('passado o intervalo mínimo grava mesmo parado', () => {
    expect(shouldRecordSample(last, { lat: -23.55, lng: -46.63 }, at(SAMPLE_MIN_INTERVAL_MS))).toBe(true)
  })

  it('andou a distância mínima grava mesmo dentro do intervalo', () => {
    // 0,0003 grau de latitude é cerca de 33 m.
    expect(shouldRecordSample(last, { lat: -23.5503, lng: -46.63 }, at(10_000))).toBe(true)
  })

  it('andou menos que a distância mínima dentro do intervalo não grava', () => {
    // 0,0001 grau de latitude é cerca de 11 m.
    expect(shouldRecordSample(last, { lat: -23.5501, lng: -46.63 }, at(10_000))).toBe(false)
  })

  it('os limites são os declarados', () => {
    expect(SAMPLE_MIN_INTERVAL_MS).toBe(60_000)
    expect(SAMPLE_MIN_DISTANCE_M).toBe(25)
  })
})

describe('selectBackfillSamples: o que chega atrasado entra na trilha pela hora em que foi medido', () => {
  const here = { lat: -23.55, lng: -46.63 }
  const sample = (ms: number, over: Partial<typeof here> = {}) => ({ ...here, ...over, recordedAt: at(ms) })

  it('sem trilha nenhuma, o primeiro ponto entra e os seguintes seguem o espaçamento', () => {
    const points = [sample(0), sample(20_000), sample(60_000), sample(70_000)]
    expect(selectBackfillSamples(null, [], points)).toEqual([sample(0), sample(60_000)])
  })

  it('movimento dentro do intervalo entra', () => {
    // 0,0003 grau de latitude é cerca de 33 m.
    const moved = sample(10_000, { lat: -23.5503 })
    expect(selectBackfillSamples(null, [], [sample(0), moved])).toEqual([sample(0), moved])
  })

  it('a amostra gravada antes do lote é o ponto de partida do espaçamento', () => {
    const before = sample(-30_000)
    expect(selectBackfillSamples(before, [], [sample(0), sample(30_000)])).toEqual([sample(30_000)])
  })

  // Reenvio depois de uma resposta perdida: os mesmos pontos chegam de novo.
  it('ponto com a hora de uma amostra já gravada não duplica', () => {
    const inside = [sample(0), sample(60_000)]
    const points = [sample(0), sample(60_000), sample(120_000)]
    expect(selectBackfillSamples(null, inside, points)).toEqual([sample(120_000)])
  })

  it('a amostra já gravada no meio do lote espaça os pontos que vêm depois dela', () => {
    const inside = [sample(60_000)]
    const points = [sample(0), sample(70_000), sample(120_000)]
    expect(selectBackfillSamples(null, inside, points)).toEqual([sample(0), sample(120_000)])
  })

  it('dois pontos com a mesma hora no lote viram um', () => {
    const twin = sample(0, { lat: -23.56 })
    expect(selectBackfillSamples(null, [], [sample(0), twin])).toEqual([sample(0)])
  })
})

describe('grade do mapa de calor', () => {
  it('a célula tem o lado declarado nas duas direções', () => {
    const { row, col } = cellOf({ lat: -23.55, lng: -46.63 })
    const center = cellCenter(row, col)
    // Cada linha tem a própria largura em longitude, então a coluna de mesmo
    // número na linha de cima não fica exatamente ao norte: a altura se mede
    // só pela latitude.
    const north = cellCenter(row + 1, col)
    expect(distanceM(center, { lat: north.lat, lng: center.lng })).toBeCloseTo(HEAT_CELL_SIZE_M, 0)
    // A próxima coluna é calculada na mesma faixa de latitude, então a
    // distância leste-oeste também é o lado da célula.
    const east = cellCenter(row, col + 1)
    expect(distanceM(center, east)).toBeCloseTo(HEAT_CELL_SIZE_M, 0)
  })

  it('o centro de uma célula cai dentro dela mesma', () => {
    const cell = cellOf({ lat: -23.55, lng: -46.63 })
    expect(cellOf(cellCenter(cell.row, cell.col))).toEqual(cell)
  })

  it('a borda inferior pertence à célula, a superior à vizinha', () => {
    const step = latStepDeg()
    const row = 100
    const lng = -46.63
    expect(cellOf({ lat: row * step, lng }).row).toBe(row)
    expect(cellOf({ lat: (row + 1) * step - 1e-9, lng }).row).toBe(row)
    expect(cellOf({ lat: (row + 1) * step, lng }).row).toBe(row + 1)
  })
})

describe('aggregateHeat: peso = minutos distintos de funcionário na célula', () => {
  const p = { lat: -23.55, lng: -46.63 }

  it('várias amostras do mesmo funcionário no mesmo minuto contam uma vez', () => {
    const cells = aggregateHeat([
      { workerId: 'w1', ...p, recordedAt: at(0) },
      { workerId: 'w1', ...p, recordedAt: at(20_000) },
      { workerId: 'w1', ...p, recordedAt: at(59_000) },
    ])
    expect(cells).toHaveLength(1)
    expect(cells[0].weight).toBe(1)
  })

  it('minutos diferentes e funcionários diferentes somam', () => {
    const cells = aggregateHeat([
      { workerId: 'w1', ...p, recordedAt: at(0) },
      { workerId: 'w1', ...p, recordedAt: at(60_000) },
      { workerId: 'w2', ...p, recordedAt: at(0) },
    ])
    expect(cells[0].weight).toBe(3)
  })

  it('pontos em células diferentes viram células diferentes, mais quentes primeiro', () => {
    const far = { lat: -23.56, lng: -46.63 }
    const cells = aggregateHeat([
      { workerId: 'w1', ...far, recordedAt: at(0) },
      { workerId: 'w1', ...p, recordedAt: at(0) },
      { workerId: 'w2', ...p, recordedAt: at(0) },
    ])
    expect(cells.map((c) => c.weight)).toEqual([2, 1])
    const hot = cellOf(p)
    expect(cells[0].lat).toBeCloseTo(cellCenter(hot.row, hot.col).lat, 10)
  })

  it('sem amostra não há célula', () => {
    expect(aggregateHeat([])).toEqual([])
  })
})
