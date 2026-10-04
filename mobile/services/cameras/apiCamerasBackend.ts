import type { CameraPoint, CamerasBackend } from './types';
import { apiRequest } from '../api/http';

// GET /cameras. O funcionário recebe só o ponto; o administrador recebe também
// o endereço e as datas do cadastro, que o mapa não usa e por isso ficam aqui.
export const apiCamerasBackend: CamerasBackend = {
  async list(): Promise<CameraPoint[]> {
    const rows = await apiRequest<CameraPoint[]>('/cameras', { auth: true });
    return rows.map(({ id, name, lat, lng }) => ({ id, name, lat, lng }));
  },
};
