import { heatShapeFromCells } from './positionHeat';

describe('heatShapeFromCells', () => {
  it('normaliza o peso pela célula mais quente e escreve [lng, lat]', () => {
    const shape = heatShapeFromCells([
      { lat: -19.9, lng: -43.9, weight: 40 },
      { lat: -19.91, lng: -43.91, weight: 10 },
    ]);
    expect(shape).toEqual({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-43.9, -19.9] }, properties: { weight: 1 } },
        { type: 'Feature', geometry: { type: 'Point', coordinates: [-43.91, -19.91] }, properties: { weight: 0.25 } },
      ],
    });
  });

  it('sem célula, o mapa não recebe ponto algum', () => {
    expect(heatShapeFromCells([])).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('célula sem presença não vira ponto', () => {
    expect(heatShapeFromCells([{ lat: 1, lng: 2, weight: 0 }]).features).toEqual([]);
  });
});
