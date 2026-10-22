// Busca de texto das telas: sem caixa e sem acento dos dois lados, senão
// "inspecao" digitado às pressas não acha "Inspeção".

export const normalizeSearch = (text: string) =>
  text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** `query` vazio (ou só espaços) acha tudo. */
export const matchesSearch = (text: string, query: string) => {
  const q = normalizeSearch(query.trim());
  return !q || normalizeSearch(text).includes(q);
};
