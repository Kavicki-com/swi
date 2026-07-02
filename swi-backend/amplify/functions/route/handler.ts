// Deploy-gated. Busca Mapbox Directions (walking) e mapeia → o shape RouteSnapshot
// devolvido pela custom query getEvacuationRoute (ver data/resource.ts). NUNCA roda
// agora (sem conta AWS); existe pra o backend ser código real + typechecked.

interface MapboxRoute {
  geometry?: { coordinates?: [number, number][] };
  duration?: number;
  distance?: number;
}
interface MapboxResponse { routes?: MapboxRoute[] }

export const handler = async (event: {
  arguments: { originLng: number; originLat: number; destLng: number; destLat: number };
}) => {
  const token = process.env.MAPBOX_TOKEN;
  const { originLng, originLat, destLng, destLat } = event.arguments;
  const coords = `${originLng},${originLat};${destLng},${destLat}`;
  const url =
    `https://api.mapbox.com/directions/v5/mapbox/walking/${coords}` +
    `?geometries=geojson&overview=full&access_token=${token}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Mapbox ${res.status}`);
  const data = (await res.json()) as MapboxResponse;
  const r = data.routes?.[0];
  return {
    waypoints: r?.geometry?.coordinates ?? [],
    durationSec: r?.duration ?? 0,
    distanceM: r?.distance ?? 0,
    fetchedAt: new Date().toISOString(),
  };
};
