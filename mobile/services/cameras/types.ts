// Pontos de câmera da obra, cadastrados pelo administrador no painel. O app só
// desenha o ponto no mapa: o endereço da câmera fica com o painel.

export interface CameraPoint {
  id: string;
  name: string;
  lat: number;
  lng: number;
}

export interface CamerasBackend {
  // Câmeras da empresa de quem está logado. Sem empresa, lista vazia.
  list(): Promise<CameraPoint[]>;
}
