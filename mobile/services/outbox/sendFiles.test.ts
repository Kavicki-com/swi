import { createStagedSendFiles, MAX_SEND_IMAGE_BYTES, passthroughSendFiles } from './sendFiles';

// Disco de mentira: uri → tamanho. As classes do dublê têm só o que o módulo
// usa do expo-file-system (exists, size, copy, delete, create, list).
const mockDisk = new Map<string, number>();
const mockDirs = new Set<string>();

jest.mock('expo-file-system', () => {
  const join = (parts: unknown[]) =>
    parts.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class File {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockDisk.has(this.uri);
    }
    get size() {
      return mockDisk.get(this.uri) ?? 0;
    }
    copy(destination: { uri: string }) {
      mockDisk.set(destination.uri, mockDisk.get(this.uri) ?? 0);
    }
    delete() {
      if (!mockDisk.delete(this.uri)) throw new Error('não existe');
    }
  }
  class Directory {
    uri: string;
    constructor(...parts: unknown[]) {
      this.uri = join(parts);
    }
    get exists() {
      return mockDirs.has(this.uri);
    }
    create() {
      mockDirs.add(this.uri);
    }
    list() {
      return [...mockDisk.keys()]
        .filter((uri) => uri.startsWith(`${this.uri}/`))
        .map((uri) => new File(uri));
    }
  }
  return { File, Directory, Paths: { document: 'file:///doc' } };
});

const DIR = 'file:///doc/send-outbox';

function arquivos() {
  let n = 0;
  return createStagedSendFiles(() => `id-${(n += 1)}`);
}

beforeEach(() => {
  mockDisk.clear();
  mockDirs.clear();
});

describe('createStagedSendFiles', () => {
  describe('stage', () => {
    // A uri do seletor aponta para o cache, que o sistema limpa quando quer. A
    // cópia fica no armazenamento do app até o envio sair.
    it('copia a foto para a pasta da fila e devolve a uri da cópia', async () => {
      mockDisk.set('file:///cache/foto.jpg', 1000);

      const uri = await arquivos().stage('file:///cache/foto.jpg');

      expect(uri).toBe(`${DIR}/id-1.jpg`);
      expect(mockDisk.get(uri)).toBe(1000);
      expect(mockDisk.has('file:///cache/foto.jpg')).toBe(true);
      expect(mockDirs.has(DIR)).toBe(true);
    });

    // A extensão da cópia decide o content-type do upload.
    it('png continua png; o resto vira jpg', async () => {
      mockDisk.set('file:///cache/tela.PNG', 10);
      mockDisk.set('file:///cache/sem-extensao', 10);
      const files = arquivos();

      expect(await files.stage('file:///cache/tela.PNG')).toBe(`${DIR}/id-1.png`);
      expect(await files.stage('file:///cache/sem-extensao')).toBe(`${DIR}/id-2.jpg`);
    });

    it('arquivo que sumiu é recusado na entrada, com o código FILE_MISSING', async () => {
      await expect(arquivos().stage('file:///cache/sumiu.jpg')).rejects.toMatchObject({
        code: 'FILE_MISSING',
      });
      expect(mockDisk.size).toBe(0);
    });

    // O presign do servidor recusa acima de 15 MB. Recusar aqui deixa a pessoa
    // trocar a foto com a tela ainda aberta.
    it('foto acima de 15 MB é recusada na entrada', async () => {
      mockDisk.set('file:///cache/enorme.jpg', MAX_SEND_IMAGE_BYTES + 1);

      await expect(arquivos().stage('file:///cache/enorme.jpg')).rejects.toThrow(/15 MB/);
      expect(mockDisk.size).toBe(1);
    });

    it('foto no limite exato passa', async () => {
      mockDisk.set('file:///cache/limite.jpg', MAX_SEND_IMAGE_BYTES);

      await expect(arquivos().stage('file:///cache/limite.jpg')).resolves.toBe(`${DIR}/id-1.jpg`);
    });
  });

  // No iOS o caminho da pasta do app muda numa atualização: a uri guardada no
  // item deixa de existir, mas o arquivo continua lá, com o mesmo nome.
  describe('locate', () => {
    const ANTIGA = 'file:///pasta-de-antes-da-atualizacao/send-outbox/a.jpg';

    it('a uri guardada antes de uma atualização aponta para a pasta de agora', () => {
      expect(arquivos().locate(ANTIGA)).toBe(`${DIR}/a.jpg`);
    });

    it('a uri que já é a de agora volta igual', () => {
      expect(arquivos().locate(`${DIR}/a.jpg`)).toBe(`${DIR}/a.jpg`);
    });

    it('uri de fora da pasta da fila não é mexida', () => {
      expect(arquivos().locate('file:///cache/foto.jpg')).toBe('file:///cache/foto.jpg');
    });

    it('descartar pela uri de antes da atualização apaga a cópia de agora', async () => {
      mockDisk.set(`${DIR}/a.jpg`, 1);

      await arquivos().discard([ANTIGA]);

      expect(mockDisk.size).toBe(0);
    });
  });

  describe('discard', () => {
    it('apaga as cópias e ignora a que já não existe', async () => {
      mockDisk.set(`${DIR}/a.jpg`, 1);

      await arquivos().discard([`${DIR}/a.jpg`, `${DIR}/ja-foi.jpg`]);

      expect(mockDisk.size).toBe(0);
    });

    it('nunca apaga arquivo fora da pasta da fila', async () => {
      mockDisk.set('file:///cache/foto.jpg', 1);

      await arquivos().discard(['file:///cache/foto.jpg']);

      expect(mockDisk.has('file:///cache/foto.jpg')).toBe(true);
    });
  });

  // Cópia sem item na fila: o app fechou entre copiar e enfileirar, ou o item
  // saiu e a exclusão falhou. A varredura do login limpa.
  describe('sweep', () => {
    it('apaga as cópias que nenhum item usa e guarda as outras', async () => {
      mockDirs.add(DIR);
      mockDisk.set(`${DIR}/em-uso.jpg`, 1);
      mockDisk.set(`${DIR}/orfa.jpg`, 1);

      await arquivos().sweep([`${DIR}/em-uso.jpg`]);

      expect([...mockDisk.keys()]).toEqual([`${DIR}/em-uso.jpg`]);
    });

    it('sem a pasta não faz nada', async () => {
      await expect(arquivos().sweep([])).resolves.toBeUndefined();
    });
  });
});

// Web e modo de demonstração: não há armazenamento do app nem servidor, e a
// foto "enviada" é a própria uri local, que tem de continuar existindo.
describe('passthroughSendFiles', () => {
  it('devolve a mesma uri e não apaga nada', async () => {
    mockDisk.set('file:///cache/foto.jpg', 1);

    await expect(passthroughSendFiles.stage('file:///cache/foto.jpg')).resolves.toBe(
      'file:///cache/foto.jpg',
    );
    await passthroughSendFiles.discard(['file:///cache/foto.jpg']);
    await passthroughSendFiles.sweep([]);

    expect(mockDisk.has('file:///cache/foto.jpg')).toBe(true);
  });
});
