import { Alert } from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import { pickExamDocument } from './pickDocument';

jest.mock('expo-document-picker', () => ({
  getDocumentAsync: jest.fn(),
}));

const LAUDO = 'file:///cache/laudo.pdf';

beforeEach(() => {
  (DocumentPicker.getDocumentAsync as jest.Mock).mockReset();
});

describe('pickExamDocument', () => {
  it('pede os tipos do exame, com cópia pro cache e um arquivo só', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: LAUDO }],
    });

    await pickExamDocument();

    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      // Mesma lista do backend pro prefixo exams (allowed-content-types.ts).
      type: ['application/pdf', 'image/jpeg', 'image/png', 'text/plain'],
      // Sem a cópia o Android devolve content:// e o new File(uri) do
      // expo-file-system não lida, o upload quebraria só lá.
      copyToCacheDirectory: true,
      multiple: false,
    });
  });

  it('devolve a uri do arquivo escolhido', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: LAUDO }],
    });
    await expect(pickExamDocument()).resolves.toBe(LAUDO);
  });

  it('cancelou: devolve null', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: true,
      assets: null,
    });
    await expect(pickExamDocument()).resolves.toBeNull();
  });

  it('sem assets mesmo sem cancelar: devolve null', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [],
    });
    await expect(pickExamDocument()).resolves.toBeNull();
  });

  // Mesmo contrato do useMediaPicker: quem chama faz `if (!uri) return;` e o
  // picker roda FORA do try do envio, lançar aqui viraria rejeição sem dono.
  it('erro do picker nativo: devolve null, não lança', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockRejectedValue(
      new Error('boom nativo'),
    );
    await expect(pickExamDocument()).resolves.toBeNull();
  });
});

// Ticket 17: o filtro de tipo do DocumentPicker não impõe TETO; um laudo acima
// de 15 MB precisa ser recusado aqui, com aviso, não com 400 depois do upload.
describe('pickExamDocument: régua de mídia', () => {
  it('laudo acima de 15 MB avisa e resolve null', async () => {
    const alerta = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: LAUDO, size: 16 * 1024 * 1024 }],
    });

    expect(await pickExamDocument()).toBeNull();
    expect(alerta.mock.calls[0][1]).toMatch(/15 MB/);
    alerta.mockRestore();
  });

  it('laudo dentro do teto segue passando', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: LAUDO, size: 1024 }],
    });

    expect(await pickExamDocument()).toBe(LAUDO);
  });
});
