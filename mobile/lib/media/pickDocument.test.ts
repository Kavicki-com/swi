import * as DocumentPicker from 'expo-document-picker';
import { pickExamDocument, pickReportDocument } from './pickDocument';

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

// Anexo de áudio ou PDF do relatório. Vídeo e foto vêm pela galeria
// (useMediaPicker); aqui entra o que a galeria não mostra.
describe('pickReportDocument', () => {
  it('pede áudio e PDF, com cópia pro cache e um arquivo só', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValue({
      canceled: false,
      assets: [{ uri: 'file:///cache/relato.m4a' }],
    });

    await expect(pickReportDocument()).resolves.toBe('file:///cache/relato.m4a');

    expect(DocumentPicker.getDocumentAsync).toHaveBeenCalledWith({
      // Mesma lista do backend pro prefixo reports (allowed-content-types.ts),
      // menos imagem e vídeo, que entram pela galeria.
      type: ['audio/mpeg', 'audio/mp4', 'audio/x-m4a', 'audio/wav', 'audio/x-wav', 'application/pdf'],
      copyToCacheDirectory: true,
      multiple: false,
    });
  });

  it('cancelado ou erro nativo devolve null', async () => {
    (DocumentPicker.getDocumentAsync as jest.Mock).mockResolvedValueOnce({ canceled: true });
    await expect(pickReportDocument()).resolves.toBeNull();
    (DocumentPicker.getDocumentAsync as jest.Mock).mockRejectedValueOnce(new Error('boom'));
    await expect(pickReportDocument()).resolves.toBeNull();
  });
});
