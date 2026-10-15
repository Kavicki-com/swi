import { attachmentIcon, attachmentTitles, formatBytes, kindLabel } from './attachmentLabels';
import type { ReportAttachment } from '../../services/reports/types';

const anexo = (kind: ReportAttachment['kind']): ReportAttachment => ({
  key: '',
  url: '',
  contentType: '',
  kind,
});

// Rótulos do anexo multimídia, os mesmos do painel: tipo em português,
// tamanho legível e "Vídeo 1", "Áudio 1" numerados por tipo (o nome original
// do arquivo não é guardado; a key é um uuid).
describe('kindLabel e attachmentIcon', () => {
  it('cada tipo tem rótulo e ícone do DS', () => {
    expect(kindLabel('image')).toBe('Imagem');
    expect(kindLabel('video')).toBe('Vídeo');
    expect(kindLabel('audio')).toBe('Áudio');
    expect(kindLabel('document')).toBe('PDF');
    expect(attachmentIcon('video')).toBe('videocam');
    expect(attachmentIcon('audio')).toBe('audio_file');
    expect(attachmentIcon('document')).toBe('attach_file');
    expect(attachmentIcon('image')).toBe('attach_file');
  });
});

describe('formatBytes', () => {
  it.each([
    [0, '0 KB'],
    [3, '1 KB'],
    [850 * 1024, '850 KB'],
    [1024 * 1024, '1,0 MB'],
    [12.3 * 1024 * 1024, '12,3 MB'],
  ])('%i bytes → %s', (bytes, texto) => {
    expect(formatBytes(bytes)).toBe(texto);
  });
});

describe('attachmentTitles', () => {
  it('numera por tipo, na ordem gravada', () => {
    expect(
      attachmentTitles([anexo('video'), anexo('audio'), anexo('video'), anexo('document')]),
    ).toEqual(['Vídeo 1', 'Áudio 1', 'Vídeo 2', 'PDF 1']);
  });
});
