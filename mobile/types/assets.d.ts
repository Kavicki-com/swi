// Importar CSS só faz sentido no bundle web, onde o bundler transforma o
// import num side-effect que injeta a folha de estilo. O TypeScript não sabe
// disso e acusa módulo inexistente, então declaramos o formato aqui.
//
// Caso de uso atual: `lib/useMapLibre.ts` carrega o CSS do maplibre-gl junto
// com o JS, sob demanda, para não pesar o bundle inicial.
declare module '*.css';
