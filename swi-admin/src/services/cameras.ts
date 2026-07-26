// Frota de câmeras do site — FONTE ÚNICA.
//
// Antes a lista vivia dentro do MapsGeneral (12 pinos) enquanto os KPIs de
// dashboard e monitoramento cravavam "564 câmeras ativas": o mapa mostrava 12,
// o número dizia 564 (QA de volume 2026-07-26). Agora quem desenha e quem conta
// leem a MESMA lista, então o painel nunca afirma câmera que não existe.
//
// Continua sendo fixture: não há integração de CFTV no piloto. Quando existir,
// isto vira uma chamada ao backend e os dois consumidores acompanham de graça.
export type CameraLocation = { id: string; lng: number; lat: number; name: string }

export const CAMERA_LOCATIONS: ReadonlyArray<CameraLocation> = [
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
]

export const ACTIVE_CAMERAS = CAMERA_LOCATIONS.length
