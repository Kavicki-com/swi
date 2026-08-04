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
      // expo-file-system não lida — o upload quebraria só lá.
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
  // picker roda FORA do try do envio — lançar aqui viraria rejeição sem dono.
  it('erro do picker nativo: devolve null, não lança', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockRejectedValue(
      new Error('boom nativo'),
    );
    await expect(pickExamDocument()).resolves.toBeNull();
  });
});
