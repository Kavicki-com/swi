import { BadRequestException } from '@nestjs/common'
import { normalizeEvacuationArea } from './evacuation-area'

// Polígono da área desenhado ao iniciar: vértices [lng, lat] (convenção
// maplibre/GeoJSON). O servidor valida e fecha o anel antes de persistir.
describe('normalizeEvacuationArea', () => {
  const pentagon: [number, number][] = [
    [-46.64, -23.53],
    [-46.6, -23.52],
    [-46.58, -23.55],
    [-46.61, -23.57],
    [-46.65, -23.56],
  ]

  it('sem área (undefined/null) devolve null — evacuação sem recorte visual', () => {
    expect(normalizeEvacuationArea(undefined)).toBeNull()
    expect(normalizeEvacuationArea(null)).toBeNull()
  })

  it('fecha o anel: repete o primeiro vértice no fim', () => {
    const area = normalizeEvacuationArea(pentagon)
    expect(area).not.toBeNull()
    expect(area!.length).toBe(pentagon.length + 1)
    expect(area!.slice(0, -1)).toEqual(pentagon)
    expect(area![area!.length - 1]).toEqual(pentagon[0])
  })

  it('anel já fechado não duplica o ponto de fechamento', () => {
    const closed = [...pentagon, pentagon[0]]
    const area = normalizeEvacuationArea(closed)
    expect(area!.length).toBe(pentagon.length + 1)
    expect(area![area!.length - 1]).toEqual(pentagon[0])
  })

  it('menos de 3 vértices distintos → 400', () => {
    expect(() => normalizeEvacuationArea([[-46.6, -23.5], [-46.5, -23.4]])).toThrow(BadRequestException)
  })

  it('não-array → 400', () => {
    expect(() => normalizeEvacuationArea({ a: 1 })).toThrow(BadRequestException)
  })

  it('vértice que não é par [lng, lat] → 400', () => {
    expect(() => normalizeEvacuationArea([[-46.6, -23.5], [-46.5], [-46.4, -23.4]] as unknown)).toThrow(
      BadRequestException,
    )
  })

  it('longitude fora de [-180, 180] → 400', () => {
    expect(() => normalizeEvacuationArea([[-200, -23.5], [-46.5, -23.4], [-46.4, -23.3]])).toThrow(
      BadRequestException,
    )
  })

  it('latitude fora de [-90, 90] → 400', () => {
    expect(() => normalizeEvacuationArea([[-46.6, -95], [-46.5, -23.4], [-46.4, -23.3]])).toThrow(
      BadRequestException,
    )
  })

  it('coordenada não finita (NaN) → 400', () => {
    expect(() => normalizeEvacuationArea([[Number.NaN, -23.5], [-46.5, -23.4], [-46.4, -23.3]])).toThrow(
      BadRequestException,
    )
  })
})
