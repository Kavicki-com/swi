import type { CamerasBackend } from './types';

// Caminho demo: sem backend não há cadastro, e o mapa fica sem câmera em vez
// de inventar pontos.
export const mockCamerasBackend: CamerasBackend = {
  async list() {
    return [];
  },
};
