// mobile/lib/mapMockData.ts
// Frontend-only seed data for the Sprint 6 mobile map migration. Wave 2
// route files (map / map-weather / evacuation*) import these constants so
// the demo renders deterministic, Figma-aligned pin layouts without a
// backend. Coordinates orbit USER_LOCATION (São Paulo Bela Vista region)
// — same area the swi-admin Dashboard / MapsGeneral mocks use, keeping
// the cross-product demo visually consistent.
import { Asset } from 'expo-asset';

// Seed neutro — São Paulo Bela Vista. Same centroid as swi-admin map mocks.
// Tuple is [lng, lat] to stay aligned with maplibre / GeoJSON conventions.
export const USER_LOCATION: [number, number] = [-46.63, -23.55];

export type PinStatus = 'good' | 'alert' | 'low';

// ----------------------------------------------------------------------
// Worker markers — 7 pontos espalhados num raio ~2km do USER_LOCATION.
// 1 degree of latitude ≈ 111 km, so 2 km ≈ 0.018° (used as the outer
// envelope; individual offsets stay within ~0.012° of center).
// ----------------------------------------------------------------------
export interface WorkerMarker {
  id: string;
  lng: number;
  lat: number;
  name: string;
  status: PinStatus;
  avatarUri: string;
}

// Avatar URIs resolved at module load — Asset.fromModule(require(...)).uri
// returns a Metro-served URI string synchronously for bundled PNGs (same
// pattern used across the mobile screens; see journey/task/[id].tsx).
// require() must be statically analyzable per Metro, so we keep each
// asset path as a literal inside its own expression.
const WORKER_AVATARS: ReadonlyArray<string> = [
  Asset.fromModule(require('../assets/avatars/worker-1.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-2.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-3.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-4.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-5.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-6.png')).uri,
  Asset.fromModule(require('../assets/avatars/worker-7.png')).uri,
];

// Avatar do usuário logado — mesma asset usada no dashboard (avatar-
// construction.png). Renderizada no map-view-general como pin permanente
// em USER_LOCATION (Figma 385:29023).
export const USER_AVATAR: string = Asset.fromModule(
  require('../assets/avatar-construction.png'),
).uri;

export const WORKER_LOCATIONS: ReadonlyArray<WorkerMarker> = [
  {
    id: 'wkr-01',
    lng: -46.638,
    lat: -23.541,
    name: 'Carlos Silva',
    status: 'good',
    avatarUri: WORKER_AVATARS[0],
  },
  {
    id: 'wkr-02',
    lng: -46.625,
    lat: -23.544,
    name: 'Mariana Souza',
    status: 'good',
    avatarUri: WORKER_AVATARS[1],
  },
  {
    id: 'wkr-03',
    lng: -46.642,
    lat: -23.553,
    name: 'João Pereira',
    status: 'alert',
    avatarUri: WORKER_AVATARS[2],
  },
  {
    id: 'wkr-04',
    lng: -46.622,
    lat: -23.551,
    name: 'Lucas Almeida',
    status: 'good',
    avatarUri: WORKER_AVATARS[3],
  },
  {
    id: 'wkr-05',
    lng: -46.633,
    lat: -23.558,
    name: 'Beatriz Costa',
    status: 'low',
    avatarUri: WORKER_AVATARS[4],
  },
  {
    id: 'wkr-06',
    lng: -46.617,
    lat: -23.557,
    name: 'Rafael Lima',
    status: 'alert',
    avatarUri: WORKER_AVATARS[5],
  },
  {
    id: 'wkr-07',
    lng: -46.628,
    lat: -23.561,
    name: 'Patrícia Rocha',
    status: 'good',
    avatarUri: WORKER_AVATARS[6],
  },
];

// ----------------------------------------------------------------------
// Camera markers — verbatim port of swi-admin MapsGeneral.tsx:118-131.
// ----------------------------------------------------------------------
export interface CameraMarker {
  id: string;
  lng: number;
  lat: number;
  name: string;
}

export const CAMERA_LOCATIONS: ReadonlyArray<CameraMarker> = [
  { id: 'cam-01', lng: -46.638, lat: -23.541, name: 'Câmera Norte 1' },
  { id: 'cam-02', lng: -46.625, lat: -23.544, name: 'Câmera Norte 2' },
  { id: 'cam-03', lng: -46.642, lat: -23.547, name: 'Câmera Centro Oeste' },
  { id: 'cam-04', lng: -46.628, lat: -23.548, name: 'Câmera Central' },
  { id: 'cam-05', lng: -46.615, lat: -23.549, name: 'Câmera Leste 1' },
  { id: 'cam-06', lng: -46.635, lat: -23.552, name: 'Câmera Sul Oeste' },
  { id: 'cam-07', lng: -46.622, lat: -23.554, name: 'Câmera Sul Central' },
  { id: 'cam-08', lng: -46.61, lat: -23.553, name: 'Câmera Sul Leste' },
  { id: 'cam-09', lng: -46.64, lat: -23.558, name: 'Câmera Periferia SW' },
  { id: 'cam-10', lng: -46.626, lat: -23.56, name: 'Câmera Sul 2' },
  { id: 'cam-11', lng: -46.615, lat: -23.562, name: 'Câmera Sul Leste 2' },
  { id: 'cam-12', lng: -46.63, lat: -23.564, name: 'Câmera Sul Periferia' },
];

// ----------------------------------------------------------------------
// Weather alert pins — 11 pontos com distribuição idêntica ao Figma
// 385:21840 map-metereologic-alerts: 6 good (success/green) + 2 alert
// (warning/orange) + 3 low (error/pink). DS LocationPin badge variant
// mapeia: good→#3EAB2E, alert→#EF8600, low→#F5667A.
// ----------------------------------------------------------------------
export interface WeatherAlertPin {
  id: string;
  lng: number;
  lat: number;
  status: PinStatus;
}

export const WEATHER_ALERT_PINS: ReadonlyArray<WeatherAlertPin> = [
  { id: 'wx-01', lng: -46.64, lat: -23.542, status: 'good' },
  { id: 'wx-02', lng: -46.626, lat: -23.543, status: 'good' },
  { id: 'wx-03', lng: -46.618, lat: -23.547, status: 'good' },
  { id: 'wx-04', lng: -46.636, lat: -23.55, status: 'good' },
  { id: 'wx-05', lng: -46.622, lat: -23.554, status: 'good' },
  { id: 'wx-06', lng: -46.629, lat: -23.557, status: 'good' },
  { id: 'wx-07', lng: -46.643, lat: -23.555, status: 'alert' },
  { id: 'wx-08', lng: -46.615, lat: -23.558, status: 'alert' },
  { id: 'wx-09', lng: -46.638, lat: -23.562, status: 'low' },
  { id: 'wx-10', lng: -46.624, lat: -23.564, status: 'low' },
  { id: 'wx-11', lng: -46.612, lat: -23.561, status: 'low' },
];

// ----------------------------------------------------------------------
// Evacuation route — origin near USER_LOCATION, destination ~1.5km away.
// 1.5km ≈ 0.0135° at this latitude. Path runs roughly north-east so the
// route bends visibly over the urban grid when OSRM is available.
// ----------------------------------------------------------------------
export const EVACUATION_ORIGIN: [number, number] = [-46.632, -23.552];
export const EVACUATION_DESTINATION: [number, number] = [-46.62, -23.544];

// `fetchEvacuationRoute` was moved to `lib/api/osrm.ts` (audit cleanup
// 2026-05-17) — it makes a real HTTP call so it didn't belong in a
// "mockData" file. Import it directly from `./api/osrm` instead.
