// O Metro escolhe liveMedia.native.ts para Android e iOS e este substituto
// para a web. O Jest resolve como iOS, então o substituto é carregado pelo
// caminho com a extensão.
const { liveMedia } = require('./liveMedia.ts') as typeof import('./liveMedia');

it('na web não há câmera para transmitir', () => {
  expect(liveMedia).toBeNull();
});
