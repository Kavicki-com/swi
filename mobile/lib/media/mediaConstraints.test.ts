import {
  EXAM_EXTENSIONS,
  IMAGE_EXTENSIONS,
  MAX_UPLOAD_BYTES,
  validatePickedMedia,
} from './mediaConstraints';

// Ticket 17: formatos e limites num módulo só, espelhando o backend
// (swi-backend/src/media/allowed-content-types.ts + MAX_UPLOAD_BYTES). A fonte
// de verdade é a assinatura do presign lá; aqui é o feedback IMEDIATO, antes de
// qualquer ida à rede. A lista multimídia final ainda é decisão do cliente:
// estender é acrescentar extensão aqui e tipo no módulo do backend.

describe('mediaConstraints', () => {
  it('espelha o teto do backend: 15 MB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(15 * 1024 * 1024);
  });

  it('imagem aceita jpg/jpeg/png; exame soma pdf e txt', () => {
    expect([...IMAGE_EXTENSIONS]).toEqual(['jpg', 'jpeg', 'png']);
    expect([...EXAM_EXTENSIONS]).toEqual(['jpg', 'jpeg', 'png', 'pdf', 'txt']);
  });

  it('aceita imagem dentro do formato e do limite', () => {
    expect(validatePickedMedia({ uri: 'file:///tmp/foto.jpg', size: 1024 })).toEqual({ ok: true });
    expect(validatePickedMedia({ uri: 'file:///tmp/foto.PNG', size: 1024 })).toEqual({ ok: true });
  });

  it('recusa formato de imagem não suportado, dizendo quais valem', () => {
    const out = validatePickedMedia({ uri: 'file:///tmp/anim.gif', size: 1024 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/JPG ou PNG/);
  });

  it('pdf é recusado como imagem mas aceito como exame', () => {
    expect(validatePickedMedia({ uri: 'file:///tmp/laudo.pdf', size: 1024 }).ok).toBe(false);
    expect(validatePickedMedia({ uri: 'file:///tmp/laudo.pdf', size: 1024 }, 'exam')).toEqual({
      ok: true,
    });
  });

  it('recusa arquivo acima do teto, citando o limite', () => {
    const out = validatePickedMedia({ uri: 'file:///tmp/foto.jpg', size: MAX_UPLOAD_BYTES + 1 });
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.reason).toMatch(/15 MB/);
  });

  // A câmera e alguns pickers devolvem uri sem extensão ou sem tamanho; o
  // upload assina como jpeg e o teto é re-checado no uploadImage. Recusar aqui
  // quebraria fluxo que funciona hoje.
  it('uri sem extensão ou sem tamanho conhecido passa (o backend decide)', () => {
    expect(validatePickedMedia({ uri: 'file:///tmp/captura' })).toEqual({ ok: true });
    expect(validatePickedMedia({ uri: 'file:///tmp/foto.jpg', size: null })).toEqual({ ok: true });
  });

  it('ignora query string ao ler a extensão', () => {
    expect(validatePickedMedia({ uri: 'file:///tmp/foto.jpg?x=1', size: 1 })).toEqual({ ok: true });
    expect(validatePickedMedia({ uri: 'file:///tmp/v.mp4?x=1', size: 1 }).ok).toBe(false);
  });
});
