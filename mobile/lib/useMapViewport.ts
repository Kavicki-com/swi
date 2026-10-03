// O que o mapa enquadra ao abrir, e os colegas que ele mostra. Com posição do
// GPS, centra nela. Sem posição, enquadra os colegas; sem colegas, o Brasil.
// Nunca um ponto de reserva inventado.
import { useEffect, useState } from 'react';
import { getPositionsBackend } from '@/services/positions/getPositionsBackend';
import type { Colleague } from '@/services/positions/types';
import { usePolledRead } from '@/services/positions/usePolledRead';
import { BRAZIL_BOUNDS, boundsAround, type Bounds } from './mapGeometry';

export type MapViewport = { center: [number, number] } | { bounds: Bounds };

// Cadência de releitura dos colegas no mapa. O app de cada um posta a posição
// a cada 10 s; 15 s acompanha sem dobrar o tráfego.
export const COLLEAGUES_REFRESH_MS = 15_000;

const readColleagues = () => getPositionsBackend().listColleagues();

export function useMapViewport(
  coords: [number, number] | null,
  showColleagues: boolean,
): { viewport: MapViewport; colleagues: readonly Colleague[] | null } {
  // undefined: ainda não decidido. Depois da primeira leitura boa fica a caixa
  // dos colegas, ou null quando não havia ninguém (o mapa segue no Brasil).
  // Decide uma vez só: reenquadrar a cada releitura arrancaria o mapa da mão
  // de quem o arrastou.
  const [frame, setFrame] = useState<Bounds | null | undefined>(undefined);
  const undecided = !coords && frame === undefined;

  // Os colegas são lidos com a camada ligada e, sem GPS, até o enquadramento
  // ser decidido. Decidido, a leitura só continua pela camada.
  const read = usePolledRead(showColleagues || undecided, readColleagues, COLLEAGUES_REFRESH_MS);

  useEffect(() => {
    if (!undecided || !read.data) return;
    setFrame(boundsAround(read.data.map((c) => [c.lng, c.lat])));
  }, [undecided, read.data]);

  return {
    viewport: coords ? { center: coords } : { bounds: frame ?? BRAZIL_BOUNDS },
    colleagues: read.data,
  };
}
