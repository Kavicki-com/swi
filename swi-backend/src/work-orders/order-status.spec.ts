import { orderStatus, orderProgressPct, distributeMinutes } from './order-status'

describe('orderStatus (recompute puro do pai)', () => {
  it('todos done → done', () => {
    expect(orderStatus(['done', 'done'])).toBe('done')
  })
  it('nenhum começado → pending', () => {
    expect(orderStatus(['pending', 'pending'])).toBe('pending')
  })
  it('misto → in_progress (paused e done contam como começado)', () => {
    expect(orderStatus(['pending', 'in_progress'])).toBe('in_progress')
    expect(orderStatus(['pending', 'paused'])).toBe('in_progress')
    expect(orderStatus(['pending', 'done'])).toBe('in_progress')
  })
  it('lista vazia → pending (invariante ≥1 item torna isso inalcançável)', () => {
    expect(orderStatus([])).toBe('pending')
  })
})

describe('orderProgressPct (done ÷ total)', () => {
  it('conta done sobre total, arredondado', () => {
    expect(orderProgressPct(['done', 'pending', 'pending'])).toBe(33)
    expect(orderProgressPct(['done', 'done'])).toBe(100)
    expect(orderProgressPct(['pending'])).toBe(0)
  })
})

describe('distributeMinutes (rateio determinístico)', () => {
  it('preserva a soma, resto nos primeiros', () => {
    expect(distributeMinutes(480, 4)).toEqual([120, 120, 120, 120])
    expect(distributeMinutes(100, 3)).toEqual([34, 33, 33])
  })
  it('total null → nulls; n=0 → []', () => {
    expect(distributeMinutes(null, 2)).toEqual([null, null])
    expect(distributeMinutes(480, 0)).toEqual([])
  })
})
