import { File } from 'expo-file-system';
import { localFileSize } from './localFileSize';

jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({ uri, size: 4096 })),
}));

// A tela do relatório lê o tamanho na ESCOLHA do arquivo, para recusar na
// hora o que passa do teto. Quando não dá para ler, devolve null e a fila de
// envios faz a conta com o tamanho real na entrada.
describe('localFileSize', () => {
  it('devolve o tamanho do arquivo', () => {
    expect(localFileSize('file:///cache/foto.jpg')).toBe(4096);
  });

  it('tamanho zero (arquivo que sumiu) vira null', () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({ uri, size: 0 }));
    expect(localFileSize('file:///cache/sumiu.jpg')).toBeNull();
  });

  it('erro do sistema de arquivos vira null, nunca lança', () => {
    (File as unknown as jest.Mock).mockImplementationOnce(() => {
      throw new Error('boom nativo');
    });
    expect(localFileSize('content://x')).toBeNull();
  });
});
