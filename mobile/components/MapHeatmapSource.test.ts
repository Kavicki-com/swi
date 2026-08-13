// Cobre a conversão de [densidade, cor] para a expressão `heatmap-color` do
// MapLibre. A função é compartilhada pelos renderers web e native, então um
// erro aqui quebra os dois mapas (produtividade e radar climático) de uma vez.
import { buildColorExpression } from './MapHeatmapSource.types';

describe('buildColorExpression', () => {
  it('gera uma expressão de cor MapLibre válida', () => {
    expect(
      buildColorExpression([
        [0, 'transparent'],
        [1, '#ff0000'],
      ]),
    ).toEqual(['interpolate', ['linear'], ['heatmap-density'], 0, 'transparent', 1, '#ff0000']);
  });

  it('preserva a ordem das paradas de cor', () => {
    expect(
      buildColorExpression([
        [0, 'rgba(0,0,0,0)'],
        [0.5, 'yellow'],
        [1, 'red'],
      ]),
    ).toEqual([
      'interpolate',
      ['linear'],
      ['heatmap-density'],
      0,
      'rgba(0,0,0,0)',
      0.5,
      'yellow',
      1,
      'red',
    ]);
  });

  it('aceita uma lista sem paradas sem quebrar a estrutura da expressão', () => {
    expect(buildColorExpression([])).toEqual(['interpolate', ['linear'], ['heatmap-density']]);
  });
});
