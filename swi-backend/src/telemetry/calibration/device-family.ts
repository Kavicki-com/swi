import type { CalibrationDeviceFamily, TelemetryDeviceKind } from '@prisma/client'

// A calibração separa relógio e pulseira porque os dois medem de jeitos
// diferentes (a pulseira mede a noite, e o repouso dela sai mais baixo).
// iPhone e manguito não leem batimento contínuo e não definem a família.

export function familyOfDeviceKind(kind: TelemetryDeviceKind): CalibrationDeviceFamily | null {
  if (kind === 'APPLE_WATCH') return 'WATCH'
  if (kind === 'ANDROID_PHONE') return 'BAND'
  return null
}

/** Família de cada leitura de batimento do dia; vence a que mais leu. */
export function dominantFamily(
  families: readonly (CalibrationDeviceFamily | null)[],
): CalibrationDeviceFamily | null {
  let watch = 0
  let band = 0
  for (const f of families) {
    if (f === 'WATCH') watch += 1
    else if (f === 'BAND') band += 1
  }
  if (watch === 0 && band === 0) return null
  return band > watch ? 'BAND' : 'WATCH'
}
