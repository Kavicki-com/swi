import type { CameraPoint } from './types';
import { getCamerasBackend } from './getCamerasBackend';
import { usePolledRead, type PolledRead } from '../positions/usePolledRead';

// O cadastro muda pouco: reler a cada poucos minutos já acompanha câmera
// criada ou excluída no painel. Depois de uma falha, a nova tentativa não
// espera esses minutos todos.
const CAMERAS_REFRESH_MS = 5 * 60_000;
const CAMERAS_RETRY_MS = 30_000;

const readCameras = () => getCamerasBackend().list();

// Camada de câmeras dos mapas: lê o cadastro quando a camada liga e para
// quando ela desliga.
export function useCameraPoints(enabled: boolean): PolledRead<CameraPoint[]> {
  return usePolledRead(enabled, readCameras, CAMERAS_REFRESH_MS, CAMERAS_RETRY_MS);
}
