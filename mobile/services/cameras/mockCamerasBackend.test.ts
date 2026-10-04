import { mockCamerasBackend } from './mockCamerasBackend';

describe('mockCamerasBackend', () => {
  // Sem backend não há cadastro: o mapa fica sem câmera em vez de inventar pontos.
  it('não tem câmera nenhuma', async () => {
    await expect(mockCamerasBackend.list()).resolves.toEqual([]);
  });
});
