import { filterCameras } from './cameraSearch'

const cameras = [
  { id: 'c1', name: 'Portaria Norte', lat: 0, lng: 0, url: null },
  { id: 'c2', name: 'Pátio', lat: 0, lng: 0, url: null },
  { id: 'c3', name: 'Depósito', lat: 0, lng: 0, url: null },
]

describe('filterCameras', () => {
  it('busca vazia ou só espaço devolve todas', () => {
    expect(filterCameras(cameras, '')).toBe(cameras)
    expect(filterCameras(cameras, '   ')).toBe(cameras)
  })

  it('acha pelo trecho do nome, sem diferenciar acento nem maiúscula', () => {
    expect(filterCameras(cameras, 'patio').map((c) => c.id)).toEqual(['c2'])
    expect(filterCameras(cameras, 'NORTE').map((c) => c.id)).toEqual(['c1'])
    expect(filterCameras(cameras, 'depó').map((c) => c.id)).toEqual(['c3'])
  })

  it('sem correspondência devolve lista vazia', () => {
    expect(filterCameras(cameras, 'guarita')).toEqual([])
  })
})
