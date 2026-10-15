// `withDeadline` fica REAL: é ele que dá prazo ao PUT direto no storage, e é
// justamente esse comportamento que o teste do prazo verifica. Só o apiRequest
// (a chamada de presign) vira dublê.
import { apiRequest } from './http';
import { File } from 'expo-file-system';
import {
  checkReportAttachment,
  contentTypeFor,
  extensionFor,
  MAX_AUDIO_BYTES,
  MAX_UPLOAD_BYTES,
  MAX_VIDEO_BYTES,
  maxBytesFor,
  reportAttachmentInfo,
  uploadImage,
  UPLOAD_TIMEOUT_MS,
  uploadTimeoutFor,
} from './uploadMedia';
jest.mock('./http', () => ({
  ...jest.requireActual('./http'),
  apiRequest: jest.fn(),
}));
jest.mock('expo-file-system', () => ({
  File: jest.fn().mockImplementation((uri: string) => ({
    uri,
    size: 32696,
    arrayBuffer: jest.fn(async () => new ArrayBuffer(32696)),
  })),
}));

// O upload é PUT presignado. O R2 NÃO implementa presigned POST, e a diferença
// muda três coisas aqui:
//  - o presign precisa do contentLength (entra na assinatura no servidor);
//  - o método é PUT com os BYTES no corpo, não multipart;
//  - o Content-Type tem que ir no header e casar com o assinado, senão 403.
describe('uploadMedia', () => {
  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (File as unknown as jest.Mock).mockClear();
    (global as any).fetch = jest.fn();
  });

  it('contentTypeFor infere png/jpeg pela extensão', () => {
    expect(contentTypeFor('file:///a/b.png')).toBe('image/png');
    expect(contentTypeFor('file:///a/b.jpg')).toBe('image/jpeg');
    expect(contentTypeFor('file:///a/b')).toBe('image/jpeg');
  });

  // Exame aceita laudo em PDF/TXT (PR 3 da unificação dos exames). Sem estes
  // casos o PDF subiria assinado como image/jpeg e o presign recusaria com
  // 400, o arquivo certo, rejeitado por content-type errado.
  it('contentTypeFor infere pdf/txt pela extensão', () => {
    expect(contentTypeFor('file:///a/laudo.pdf')).toBe('application/pdf');
    expect(contentTypeFor('file:///a/laudo.txt')).toBe('text/plain');
    expect(contentTypeFor('file:///a/LAUDO.PDF')).toBe('application/pdf');
    expect(contentTypeFor('file:///a/laudo.pdf?x=1')).toBe('application/pdf');
  });

  it('presign leva contentLength; upload é PUT com bytes e Content-Type casado', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'https://r2/bucket/k', key: 'reports/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const key = await uploadImage('file:///a/b.jpg');

    expect(apiRequest).toHaveBeenCalledWith('/media/presign', {
      method: 'POST',
      body: { contentType: 'image/jpeg', contentLength: 32696, prefix: 'reports' },
      auth: true,
    });
    const [url, init] = (global as any).fetch.mock.calls[0];
    expect(url).toBe('https://r2/bucket/k');
    expect(init.method).toBe('PUT');
    // O header TEM que existir e casar com o content-type assinado, divergir
    // dá 403 SignatureDoesNotMatch (verificado no R2 real).
    expect(init.headers['Content-Type']).toBe('image/jpeg');
    expect(init.body).toBeInstanceOf(ArrayBuffer);
    expect((init.body as ArrayBuffer).byteLength).toBe(32696);
    expect(key).toBe('reports/k.jpg');
  });

  it('repassa o prefixo', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'task/k.jpg' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 200 });
    await uploadImage('file:///a/b.jpg', 'task');
    expect(apiRequest).toHaveBeenCalledWith('/media/presign', {
      method: 'POST',
      body: { contentType: 'image/jpeg', contentLength: 32696, prefix: 'task' },
      auth: true,
    });
  });

  // Arquivo vazio (ou uri morta, que o expo devolve como size 0) faria o
  // servidor recusar o presign com 400. Barrar aqui evita a ida à rede e dá
  // mensagem melhor que o erro do storage.
  it('arquivo vazio falha antes de pedir presign', async () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({
      uri,
      size: 0,
      arrayBuffer: jest.fn(),
    }));
    await expect(uploadImage('file:///a/vazio.jpg')).rejects.toThrow(/vazio|não encontrado/i);
    expect(apiRequest).not.toHaveBeenCalled();
  });

  // A fila de envios lê o código: foto que sumiu nunca vai subir, então o item
  // sai da fila em vez de esperar a rede para sempre.
  it('arquivo vazio falha com o código FILE_MISSING', async () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({
      uri,
      size: 0,
      arrayBuffer: jest.fn(),
    }));
    await expect(uploadImage('file:///a/vazio.jpg')).rejects.toMatchObject({ code: 'FILE_MISSING' });
  });

  it('propaga falha do PUT com status e detalhe', async () => {
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'k' });
    (global as any).fetch.mockResolvedValueOnce({
      ok: false,
      status: 403,
      text: async () => 'SignatureDoesNotMatch',
    });
    await expect(uploadImage('file:///a/b.jpg')).rejects.toThrow(/403.*SignatureDoesNotMatch/);
  });

  // Este PUT vai direto no storage, fora do apiRequest, então não herda o prazo
  // de lá. Sem prazo, um upload que trava deixa "Salvar relatório" girando
  // para sempre. O prazo aqui é maior
  // porque trafegam até 15 MB, contra um JSON pequeno nas outras chamadas.
  it('estoura prazo quando o PUT trava, e aborta a conexão', async () => {
    jest.useFakeTimers();
    try {
      (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'k' });
      let signal: AbortSignal | undefined;
      (global as any).fetch.mockImplementation((_u: string, init: RequestInit) => {
        signal = init.signal as AbortSignal;
        return new Promise(() => {});
      });

      const p = uploadImage('file:///a/b.jpg');
      const rejects = expect(p).rejects.toThrow(/Tempo esgotado/);
      await jest.advanceTimersByTimeAsync(UPLOAD_TIMEOUT_MS);
      await rejects;
      expect(signal?.aborted).toBe(true);
    } finally {
      jest.useRealTimers();
    }
  });
});

// Anexo multimídia do relatório (Anexo I). Espelha o backend
// (swi-backend/src/media/allowed-content-types.ts): em reports entram imagem,
// vídeo, áudio e PDF, com teto por tipo. As frases são as mesmas do painel,
// para a recusa ler igual nos dois lugares.
describe('regras do anexo de relatório', () => {
  const MB = 1024 * 1024;

  beforeEach(() => {
    (apiRequest as jest.Mock).mockReset();
    (File as unknown as jest.Mock).mockClear();
    (global as any).fetch = jest.fn();
  });

  it('contentTypeFor infere vídeo e áudio pela extensão', () => {
    expect(contentTypeFor('file:///a/campo.mp4')).toBe('video/mp4');
    expect(contentTypeFor('file:///a/campo.MOV')).toBe('video/quicktime');
    expect(contentTypeFor('file:///a/relato.mp3')).toBe('audio/mpeg');
    expect(contentTypeFor('file:///a/relato.m4a')).toBe('audio/mp4');
    expect(contentTypeFor('file:///a/relato.wav')).toBe('audio/wav');
  });

  // A cópia da fila de envios é nomeada pela extensão, e é dela que o upload
  // deduz o content-type: trocar .mp4 por .jpg assinaria o vídeo como imagem.
  it('extensionFor devolve a extensão da cópia, jpg para o desconhecido', () => {
    expect(extensionFor('video/mp4')).toBe('mp4');
    expect(extensionFor('video/quicktime')).toBe('mov');
    expect(extensionFor('audio/mpeg')).toBe('mp3');
    expect(extensionFor('audio/mp4')).toBe('m4a');
    expect(extensionFor('audio/wav')).toBe('wav');
    expect(extensionFor('application/pdf')).toBe('pdf');
    expect(extensionFor('image/png')).toBe('png');
    expect(extensionFor('image/jpeg')).toBe('jpg');
    expect(extensionFor('application/x-msdownload')).toBe('jpg');
  });

  it('teto por tipo: vídeo 100 MB, áudio 25 MB, o resto 15 MB', () => {
    expect(MAX_VIDEO_BYTES).toBe(100 * MB);
    expect(MAX_AUDIO_BYTES).toBe(25 * MB);
    expect(maxBytesFor('video/mp4')).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesFor('video/quicktime')).toBe(MAX_VIDEO_BYTES);
    expect(maxBytesFor('audio/mpeg')).toBe(MAX_AUDIO_BYTES);
    expect(maxBytesFor('audio/wav')).toBe(MAX_AUDIO_BYTES);
    expect(maxBytesFor('image/jpeg')).toBe(MAX_UPLOAD_BYTES);
    expect(maxBytesFor('application/pdf')).toBe(MAX_UPLOAD_BYTES);
    expect(maxBytesFor('desconhecido')).toBe(MAX_UPLOAD_BYTES);
  });

  it('reportAttachmentInfo diz o tipo do anexo pela uri, null fora da lista', () => {
    expect(reportAttachmentInfo('file:///a/foto.jpg')).toEqual({ contentType: 'image/jpeg', kind: 'image' });
    expect(reportAttachmentInfo('file:///a/campo.mov')).toEqual({ contentType: 'video/quicktime', kind: 'video' });
    expect(reportAttachmentInfo('file:///a/relato.m4a')).toEqual({ contentType: 'audio/mp4', kind: 'audio' });
    expect(reportAttachmentInfo('file:///a/laudo.pdf')).toEqual({ contentType: 'application/pdf', kind: 'document' });
    // txt é só de exame; executável não entra em lugar nenhum.
    expect(reportAttachmentInfo('file:///a/nota.txt')).toBeNull();
    expect(reportAttachmentInfo('file:///a/x.exe')).toBeNull();
  });

  // Uri da câmera sem extensão sempre foi tratada como jpeg: continua.
  it('uri sem extensão segue como imagem jpeg', () => {
    expect(reportAttachmentInfo('file:///a/sem-extensao')).toEqual({
      contentType: 'image/jpeg',
      kind: 'image',
    });
  });

  it('checkReportAttachment recusa tipo e tamanho com a frase do painel', () => {
    expect(checkReportAttachment('file:///a/nota.txt', 10)).toBe(
      'Tipo de arquivo não aceito. Selecione JPG, PNG, MP4, MOV, MP3, M4A, WAV ou PDF.',
    );
    expect(checkReportAttachment('file:///a/campo.mp4', 100 * MB + 1)).toBe(
      'O arquivo excede o limite de 100 MB para vídeo.',
    );
    expect(checkReportAttachment('file:///a/relato.mp3', 25 * MB + 1)).toBe(
      'O arquivo excede o limite de 25 MB para áudio.',
    );
    expect(checkReportAttachment('file:///a/laudo.pdf', 15 * MB + 1)).toBe(
      'O arquivo excede o limite de 15 MB para PDF.',
    );
    expect(checkReportAttachment('file:///a/foto.jpg', 15 * MB + 1)).toBe(
      'O arquivo excede o limite de 15 MB para imagem.',
    );
  });

  it('checkReportAttachment aceita o teto exato e devolve null', () => {
    expect(checkReportAttachment('file:///a/campo.mp4', 100 * MB)).toBeNull();
    expect(checkReportAttachment('file:///a/relato.mp3', 25 * MB)).toBeNull();
    expect(checkReportAttachment('file:///a/foto.jpg', 15 * MB)).toBeNull();
  });

  // Sem o tamanho (a tela não conseguiu ler o arquivo) só o tipo é checado:
  // a fila de envios refaz a checagem com o tamanho real na entrada.
  it('checkReportAttachment sem tamanho só olha o tipo', () => {
    expect(checkReportAttachment('file:///a/campo.mp4', null)).toBeNull();
    expect(checkReportAttachment('file:///a/nota.txt', null)).toMatch(/não aceito/);
  });

  // O prazo do PUT cresce com o arquivo: 90 s bastam para 15 MB, não para um
  // vídeo de 100 MB em 4G. Teto de 10 min para não pendurar a tela para sempre.
  it('uploadTimeoutFor cresce com o tamanho, entre 90 s e 10 min', () => {
    expect(uploadTimeoutFor(1 * MB)).toBe(UPLOAD_TIMEOUT_MS);
    expect(uploadTimeoutFor(15 * MB)).toBe(150_000);
    expect(uploadTimeoutFor(100 * MB)).toBe(600_000);
  });

  it('upload de vídeo assina video/mp4 e sobe o mesmo content-type', async () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({
      uri,
      size: 50 * MB,
      arrayBuffer: jest.fn(async () => new ArrayBuffer(8)),
    }));
    (apiRequest as jest.Mock).mockResolvedValue({ url: 'u', key: 'reports/k.mp4' });
    (global as any).fetch.mockResolvedValueOnce({ ok: true, status: 200 });

    await expect(uploadImage('file:///a/campo.mp4', 'reports')).resolves.toBe('reports/k.mp4');

    expect(apiRequest).toHaveBeenCalledWith('/media/presign', {
      method: 'POST',
      body: { contentType: 'video/mp4', contentLength: 50 * MB, prefix: 'reports' },
      auth: true,
    });
    expect((global as any).fetch.mock.calls[0][1].headers['Content-Type']).toBe('video/mp4');
  });

  // Recusar antes do presign poupa a rede e dá a frase certa em vez do 400.
  it('upload acima do teto do tipo falha antes de pedir presign', async () => {
    (File as unknown as jest.Mock).mockImplementationOnce((uri: string) => ({
      uri,
      size: 25 * MB + 1,
      arrayBuffer: jest.fn(),
    }));
    await expect(uploadImage('file:///a/relato.mp3', 'reports')).rejects.toThrow(
      'O arquivo excede o limite de 25 MB para áudio.',
    );
    expect(apiRequest).not.toHaveBeenCalled();
  });
});
