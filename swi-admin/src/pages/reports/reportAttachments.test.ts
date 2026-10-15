// vitest globals (describe/it/expect) via globals: true.
import {
  attachmentItems,
  formatBytes,
  kindLabel,
  pickedDescription,
  toAttachmentKind,
} from './reportAttachments'
import type { ReportAttachment } from '@/services/api/reports'

const att = (kind: ReportAttachment['kind'], url: string): ReportAttachment => ({
  key: '',
  url,
  contentType: '',
  kind,
})

describe('formatBytes', () => {
  it.each([
    [0, '0 KB'],
    // Arquivo minúsculo não aparece como "0 KB", que leria como vazio.
    [3, '1 KB'],
    [850 * 1024, '850 KB'],
    [1024 * 1024, '1,0 MB'],
    [3.24 * 1024 * 1024, '3,2 MB'],
    [100 * 1024 * 1024, '100,0 MB'],
  ])('%i bytes → %s', (bytes, text) => {
    expect(formatBytes(bytes)).toBe(text)
  })
})

describe('rótulo e tipo do DS', () => {
  it('cada tipo tem rótulo em português', () => {
    expect(kindLabel('image')).toBe('Imagem')
    expect(kindLabel('video')).toBe('Vídeo')
    expect(kindLabel('audio')).toBe('Áudio')
    expect(kindLabel('document')).toBe('PDF')
  })

  it('documento vira o `file` do AttachmentList (cartão com clipe)', () => {
    expect(toAttachmentKind('document')).toBe('file')
    expect(toAttachmentKind('video')).toBe('video')
  })
})

// O operador vê tipo e tamanho ANTES de enviar: a linha do anexo escolhido
// traz os dois depois do nome.
describe('pickedDescription', () => {
  it('nome · tipo · tamanho', () => {
    expect(pickedDescription('relato.m4a', 'audio', 3.24 * 1024 * 1024)).toBe(
      'relato.m4a · Áudio · 3,2 MB',
    )
  })
})

describe('attachmentItems', () => {
  it('nome vem da URL; miniatura só para imagem; documento vira file', () => {
    const items = attachmentItems(
      [
        att('image', 'https://cdn/r/foto-1.jpg?sig=1'),
        att('video', 'https://cdn/r/v.mp4?sig=1'),
        att('document', 'https://cdn/r/laudo.pdf'),
      ],
      ['view', 'download'],
    )
    expect(items).toEqual([
      {
        id: 'att_0',
        name: 'foto-1.jpg',
        kind: 'image',
        thumbnailUri: 'https://cdn/r/foto-1.jpg?sig=1',
        actions: ['view', 'download'],
      },
      {
        id: 'att_1',
        name: 'v.mp4',
        kind: 'video',
        thumbnailUri: undefined,
        actions: ['view', 'download'],
      },
      {
        id: 'att_2',
        name: 'laudo.pdf',
        kind: 'file',
        thumbnailUri: undefined,
        actions: ['view', 'download'],
      },
    ])
  })

  it('URL sem nome usável cai em rótulo do tipo numerado por tipo', () => {
    const items = attachmentItems([att('video', ''), att('audio', ''), att('video', '')], ['view'])
    expect(items.map((i) => i.name)).toEqual(['Vídeo 1', 'Áudio 1', 'Vídeo 2'])
  })
})
