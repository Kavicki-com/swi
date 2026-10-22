import { matchesSearch, normalizeSearch } from './searchText';

// A busca das telas de relatório: sem acento e sem maiúsculas dos dois lados,
// senão "inspecao" digitado às pressas não acha "Inspeção".

describe('normalizeSearch', () => {
  it('tira acento e caixa', () => {
    expect(normalizeSearch('Inspeção NÚMERO Ação')).toBe('inspecao numero acao');
  });
});

describe('matchesSearch', () => {
  it('acha com ou sem acento, em qualquer caixa', () => {
    expect(matchesSearch('Inspeção das Máquinas', 'INSPECAO')).toBe(true);
    expect(matchesSearch('Inspecao das maquinas', 'máquinas')).toBe(true);
  });

  it('ignora os espaços nas pontas do texto buscado', () => {
    expect(matchesSearch('Socorro', '  socorro ')).toBe(true);
  });

  it('busca vazia acha tudo', () => {
    expect(matchesSearch('Qualquer coisa', '   ')).toBe(true);
  });

  it('não acha o que não está no texto', () => {
    expect(matchesSearch('Vazamento', 'socorro')).toBe(false);
  });
});
