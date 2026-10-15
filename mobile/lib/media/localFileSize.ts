import { File } from 'expo-file-system';

/**
 * Tamanho de um arquivo local, ou null quando não dá para ler (uri que o
 * sistema já limpou, ou esquema que o expo-file-system não abre). Nunca
 * lança: a tela usa isto na escolha do anexo, e um erro aqui não pode
 * derrubar o formulário preenchido.
 */
export function localFileSize(uri: string): number | null {
  try {
    const size = new File(uri).size;
    return size > 0 ? size : null;
  } catch {
    return null;
  }
}
