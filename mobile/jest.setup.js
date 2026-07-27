// react-native-keyboard-controller tem parte nativa: fora de um app compilado
// ele lança "doesn't seem to be linked", e QUALQUER teste que renderize uma
// tela com campo de texto morre na importação.
//
// O mock é publicado pelo próprio pacote (troca os componentes de teclado por
// View/ScrollView e zera os valores animados), então não escrevemos um dublê
// caseiro que precisaria acompanhar a API da biblioteca.
jest.mock('react-native-keyboard-controller', () =>
  require('react-native-keyboard-controller/jest'),
);
