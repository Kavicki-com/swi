// mobile/lib/mapStyle.ts
// Shared maplibre style spec. Verbatim port of swi-admin/src/pages/maps/
// MapsGeneral.tsx:38-60 — both apps consume the same ESRI World Imagery
// tile source so satellite imagery stays visually consistent across the
// admin dashboard and the mobile demo.
import type maplibregl from 'maplibre-gl';

// ESRI World Imagery — same tile source the Dashboard MapBanner uses.
export const ESRI_SATELLITE_STYLE: maplibregl.StyleSpecification = {
  version: 8 as const,
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution:
        'Tiles &copy; Esri &mdash; Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community',
      minzoom: 0,
      maxzoom: 19,
    },
  },
  layers: [
    {
      id: 'esri-imagery',
      type: 'raster' as const,
      source: 'esri-imagery',
    },
  ],
};
