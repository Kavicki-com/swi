// Busca de câmera pelo nome, a mesma na seção Câmeras e no mapa geral.
// Sem diferenciar acento nem maiúscula: "patio" acha "Pátio".
import type { Camera } from '@/services/api/cameras'

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function filterCameras<T extends Pick<Camera, 'name'>>(
  cameras: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const needle = normalize(query.trim())
  if (!needle) return cameras
  return cameras.filter((c) => normalize(c.name).includes(needle))
}
