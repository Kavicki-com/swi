// Single source of truth for the satellite raster style used by MapsGeneral,
// AlertsList, AlertsRescueRoute and (eventually) the dashboard MapBanner.
//
// Provider: Mapbox Satellite (v4 raster tiles). Replaced ESRI World Imagery
// because ESRI's z17+ coverage is patchy outside major US/EU/Asia urban
// centres, producing visible "Map data not yet available" placeholders in
// Brazilian mining/industrial regions. Mapbox + Maxar Vivid gives consistent
// z18-22 coverage worldwide on the free tier.
//
// Token: pk.* public token, read from VITE_MAPBOX_TOKEN at module load. The
// token MUST be URL-restricted at account.mapbox.com (allowed origins) — pk
// tokens are safe in client bundles ONLY when origin-locked.

const MAPBOX_TOKEN = import.meta.env.VITE_MAPBOX_TOKEN as string | undefined

if (!MAPBOX_TOKEN && typeof window !== 'undefined') {
  // QA C4: sem token os tiles do Mapbox falhavam com centenas de 401 e o mapa
  // virava um vazio preto. Agora a ausência cai no Esri (aviso segue útil:
  // Mapbox tem cobertura z17+ melhor no interior do BR).
  console.warn(
    '[mapStyles] VITE_MAPBOX_TOKEN ausente — usando fallback Esri World Imagery (cobertura z17+ inferior). Copie .env.example para .env.local para usar Mapbox.',
  )
}

// Fonte condicional: Mapbox quando há token (provider preferido — cobertura),
// Esri World Imagery (sem chave) como fallback funcional. Mesmo shape de style
// pros três consumidores (MapsGeneral, AlertsList, AlertsRescueRoute).
const SOURCE = MAPBOX_TOKEN
  ? {
      type: 'raster' as const,
      tiles: [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${MAPBOX_TOKEN}`,
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minzoom: 0,
      maxzoom: 22,
    }
  : {
      type: 'raster' as const,
      // Esri: atenção à ordem {z}/{y}/{x} (y antes de x) — igual ao MapBanner
      // do dashboard, que sempre usou Esri e nunca quebrou sem chave.
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      minzoom: 0,
      maxzoom: 19,
    }

export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: SOURCE,
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster' as const,
      source: 'satellite',
    },
  ],
}

// Label curto do overlay MapAttribution — acompanha o provider ativo (um
// hardcode aqui mentiria a atribuição quando o fallback Esri está servindo).
export const SATELLITE_ATTRIBUTION_LABEL = MAPBOX_TOKEN
  ? '© Mapbox © OpenStreetMap'
  : '© Esri — World Imagery'
