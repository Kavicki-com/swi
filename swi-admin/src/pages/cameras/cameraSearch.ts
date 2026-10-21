// Busca pelo nome: câmera na seção Câmeras e no mapa geral, operador no mapa
// geral. Sem diferenciar acento nem maiúscula: "patio" acha "Pátio".
import type { Camera } from '@/services/api/cameras'

const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()

export function filterByName<T extends { name: string }>(
  items: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  const needle = normalize(query.trim())
  if (!needle) return items
  return items.filter((i) => normalize(i.name).includes(needle))
}

export function filterCameras<T extends Pick<Camera, 'name'>>(
  cameras: ReadonlyArray<T>,
  query: string,
): ReadonlyArray<T> {
  return filterByName(cameras, query)
}
