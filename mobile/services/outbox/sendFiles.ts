import { Directory, File, Paths } from 'expo-file-system';
import { contentTypeFor, extensionFor, MAX_UPLOAD_BYTES, sizeLimitError } from '../api/uploadMedia';

// Os anexos dos envios da fila (foto, e no relatório também vídeo, áudio e
// PDF). A uri que o seletor devolve aponta para o cache, que o sistema limpa
// quando quer; um envio pode esperar horas pelo sinal. Por isso o arquivo é
// copiado para o armazenamento do app ao entrar na fila, e a cópia só sai
// quando o envio sai.

/** O teto de imagem do presign no backend (MAX_UPLOAD_BYTES). Vídeo e áudio têm o seu. */
export const MAX_SEND_IMAGE_BYTES = MAX_UPLOAD_BYTES;

export const SEND_FILES_DIR_NAME = 'send-outbox';

export interface SendFiles {
  /**
   * Copia o arquivo para o armazenamento do app e devolve a uri da cópia.
   * Recusa aqui o que o servidor recusaria depois: arquivo que sumiu (erro com
   * `code: 'FILE_MISSING'`) e arquivo acima do teto do tipo.
   */
  stage(uri: string): Promise<string>;
  /**
   * Onde a cópia está agora. A uri guardada no item pode ser a de antes de uma
   * atualização do app (no iOS o caminho da pasta muda); o nome não muda.
   */
  locate(uri: string): string;
  /** Apaga as cópias. Cópia que já não existe não é erro. */
  discard(uris: readonly string[]): Promise<void>;
  /** Apaga toda cópia que não está em `keep` (sobra de um envio interrompido). */
  sweep(keep: readonly string[]): Promise<void>;
}

const baseName = (uri: string) => uri.slice(uri.lastIndexOf('/') + 1);

/**
 * Armazenamento real. A pasta nasce no primeiro uso, e não aqui: a fila é
 * montada inclusive onde `expo-file-system` é dublê (a suíte).
 */
export function createStagedSendFiles(
  newName: () => string,
  dirName: string = SEND_FILES_DIR_NAME,
): SendFiles {
  const directory = () => new Directory(Paths.document, dirName);
  const marker = `/${dirName}/`;
  const locate = (uri: string) =>
    uri.includes(marker) ? new File(directory(), baseName(uri)).uri : uri;

  return {
    async stage(uri) {
      const source = new File(uri);
      // O expo devolve size 0 para arquivo inexistente (uri do seletor que o
      // sistema já limpou, por exemplo).
      if (!source.size) {
        throw Object.assign(
          new Error('Arquivo vazio ou não encontrado. Selecione a imagem novamente.'),
          { code: 'FILE_MISSING' },
        );
      }
      const contentType = contentTypeFor(uri);
      // Teto do tipo (vídeo 100 MB, áudio 25 MB, o resto 15 MB), com a mesma
      // frase que o painel mostra.
      const refused = sizeLimitError(contentType, source.size);
      if (refused) throw new Error(refused);
      const dir = directory();
      if (!dir.exists) dir.create({ intermediates: true, idempotent: true });
      // A extensão da cópia é a que o upload usa para inferir o content-type:
      // um vídeo copiado como .jpg subiria assinado como imagem.
      const copy = new File(dir, `${newName()}.${extensionFor(contentType)}`);
      source.copy(copy);
      return copy.uri;
    },

    locate,

    async discard(uris) {
      for (const uri of uris) {
        // Só o que está na pasta da fila: a uri original do seletor não é nossa.
        if (!uri.includes(marker)) continue;
        try {
          new File(locate(uri)).delete();
        } catch {
          // Já não existe: é o estado que se queria.
        }
      }
    },

    async sweep(keep) {
      const dir = directory();
      if (!dir.exists) return;
      const kept = new Set(keep.map(baseName));
      for (const entry of dir.list()) {
        if (!(entry instanceof File) || kept.has(baseName(entry.uri))) continue;
        try {
          entry.delete();
        } catch {
          // A próxima varredura tenta de novo.
        }
      }
    },
  };
}

/**
 * Sem armazenamento do app (web) ou sem servidor (modo de demonstração): a
 * foto fica onde está, e nada é apagado, porque a uri local é a própria foto
 * que o relatório criado vai mostrar.
 */
export const passthroughSendFiles: SendFiles = {
  async stage(uri) {
    return uri;
  },
  locate(uri) {
    return uri;
  },
  async discard() {},
  async sweep() {},
};
