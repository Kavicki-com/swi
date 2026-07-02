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
  // Dev-time warning. Test env stubs maplibre-gl so tiles never load there.
  // eslint-disable-next-line no-console
  console.warn(
    '[mapStyles] VITE_MAPBOX_TOKEN missing — satellite tiles will fail. Copy .env.example to .env.local.',
  )
}

export const SATELLITE_STYLE = {
  version: 8 as const,
  sources: {
    satellite: {
      type: 'raster' as const,
      tiles: [
        `https://api.mapbox.com/v4/mapbox.satellite/{z}/{x}/{y}.jpg?access_token=${MAPBOX_TOKEN ?? ''}`,
      ],
      tileSize: 256,
      attribution:
        '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      minzoom: 0,
      maxzoom: 22,
    },
  },
  layers: [
    {
      id: 'satellite',
      type: 'raster' as const,
      source: 'satellite',
    },
  ],
}
