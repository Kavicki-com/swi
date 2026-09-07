// Limites de paginação do histórico de sessão. Vivem sozinhos porque os dois
// lados precisam deles e nenhum deve depender do outro: o DTO valida a entrada
// da rota, o serviço aplica o padrão de quem chama sem limite. Enquanto o teto
// morava no serviço, carregar o DTO carregava o cliente do Prisma e o projetor
// atrás, e um pacote de contrato compartilhado com o mobile não conseguiria
// levar o DTO sem levar o backend inteiro.

/** Teto por página. Acima disso a rota recusa, e o serviço grampeia. */
export const HISTORY_MAX_LIMIT = 500

/** Página de quem não pede tamanho. */
export const HISTORY_DEFAULT_LIMIT = 200
