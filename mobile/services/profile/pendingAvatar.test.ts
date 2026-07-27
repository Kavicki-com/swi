import * as SecureStore from 'expo-secure-store';
import { clearPendingAvatar, readPendingAvatar, stashPendingAvatar } from './pendingAvatar';

jest.mock('expo-secure-store', () => ({
  getItemAsync: jest.fn(),
  setItemAsync: jest.fn(),
  deleteItemAsync: jest.fn(),
}));
jest.mock('expo-file-system', () => {
  const arquivos = new Map<string, boolean>();
  class FakeFile {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = partes
        .map((p: any) => (typeof p === 'string' ? p : (p?.uri ?? '')))
        .join('/');
    }
    get exists() { return arquivos.get(this.uri) ?? false; }
    copy(destino: any) { arquivos.set(destino.uri, true); }
    delete() { arquivos.delete(this.uri); }
  }
  return {
    File: FakeFile,
    Paths: { document: { uri: 'file:///documents' } },
    __arquivos: arquivos,
  };
});

const mockGet = SecureStore.getItemAsync as jest.Mock;
const mockSet = SecureStore.setItemAsync as jest.Mock;
const mockDel = SecureStore.deleteItemAsync as jest.Mock;
const fsMock = jest.requireMock('expo-file-system') as {
  __arquivos: Map<string, boolean>;
  File: { prototype: { copy: (d: unknown) => void } };
};

const ORIGEM = 'file:///tmp/selfie.jpg';

beforeEach(() => {
  jest.clearAllMocks();
  fsMock.__arquivos.clear();
});

// A foto escolhida no passo 1 do cadastro nao pode subir na hora: o wizard roda
// ANTES da conta existir, e /media/presign exige token. Ela espera ate o
// primeiro login.
//
// O ponto critico e COPIAR os bytes. O endereco que o seletor devolve
// (`ph://` no iOS) e um handle temporario — guardar so a URI e tentar usar
// dias depois, quando o admin aprovar, falharia em silencio. Que e pior que
// nao oferecer o campo.
describe('pendingAvatar', () => {
  it('copia o arquivo pro armazenamento do app, nao guarda so o endereco', async () => {
    await stashPendingAvatar(ORIGEM);

    const guardado = mockSet.mock.calls[0][1];
    expect(guardado).not.toBe(ORIGEM);
    expect(guardado).toContain('file:///documents');
    // O que importa: existe copia de verdade no destino.
    expect(fsMock.__arquivos.get(guardado)).toBe(true);
  });

  it('preserva a extensao — o content-type do upload sai dela', async () => {
    await stashPendingAvatar('file:///tmp/foto.png');
    expect(mockSet.mock.calls[0][1]).toMatch(/\.png$/);
  });

  it('read devolve null quando nao ha nada guardado', async () => {
    mockGet.mockResolvedValue(null);
    expect(await readPendingAvatar()).toBeNull();
  });

  // Reinstalar o app apaga o armazenamento mas o SecureStore pode sobreviver:
  // um caminho apontando pra arquivo inexistente faria o flush estourar no
  // primeiro login, justo quando a pessoa acabou de ser aprovada.
  it('read devolve null quando o arquivo sumiu do disco', async () => {
    mockGet.mockResolvedValue('file:///documents/sumiu.jpg');
    expect(await readPendingAvatar()).toBeNull();
  });

  it('read devolve o caminho quando o arquivo esta la', async () => {
    const caminho = 'file:///documents/existe.jpg';
    fsMock.__arquivos.set(caminho, true);
    mockGet.mockResolvedValue(caminho);
    expect(await readPendingAvatar()).toBe(caminho);
  });

  it('clear apaga a copia do disco, nao so a referencia', async () => {
    const caminho = 'file:///documents/existe.jpg';
    fsMock.__arquivos.set(caminho, true);
    mockGet.mockResolvedValue(caminho);

    await clearPendingAvatar();

    expect(fsMock.__arquivos.has(caminho)).toBe(false);
    expect(mockDel).toHaveBeenCalled();
  });

  // Falhar aqui nao pode derrubar o cadastro: a foto e opcional, e perder o
  // wizard inteiro por causa dela seria desproporcional.
  it('falha ao copiar nao propaga — a foto e opcional', async () => {
    const original = fsMock.File.prototype.copy;
    fsMock.File.prototype.copy = () => { throw new Error('disco cheio'); };
    await expect(stashPendingAvatar(ORIGEM)).resolves.toBeUndefined();
    fsMock.File.prototype.copy = original;
  });
});
