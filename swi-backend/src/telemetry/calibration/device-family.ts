import type { CalibrationDeviceFamily, TelemetryDeviceKind } from '@prisma/client'

// A calibração separa relógio e pulseira porque os dois medem de jeitos
// diferentes (a pulseira mede a noite, e o repouso dela sai mais baixo).
// O aparelho cadastrado é o celular que repassa o vestível: o iPhone repassa
// o Apple Watch, e o Android, a pulseira pelo Health Connect. Manguito não lê
// batimento contínuo e não define a família.

export function familyOfDeviceKind(kind: TelemetryDeviceKind): CalibrationDeviceFamily | null {
  if (kind === 'APPLE_WATCH' || kind === 'IPHONE') return 'WATCH'
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
