// src/lib/formatDateShort.ts
// Convert BR-format `dd/mm/yyyy` (used in mock seeds and filters) into the
// short PT-BR display "dd mmm yyyy" used by the redesigned report cards
// (QA cliente §4 mockup).
const MONTHS_PT_BR_SHORT = [
  'jan',
  'fev',
  'mar',
  'abr',
  'mai',
  'jun',
  'jul',
  'ago',
  'set',
  'out',
  'nov',
  'dez',
] as const

export function formatDateShort(input: string): string {
  const parts = input.split('/').map((value) => Number(value))
  const [day, month, year] = parts
  if (
    parts.length !== 3 ||
    !Number.isFinite(day) ||
    !Number.isFinite(month) ||
    !Number.isFinite(year) ||
    month! < 1 ||
    month! > 12
  ) {
    return input
  }
  return `${day} ${MONTHS_PT_BR_SHORT[month! - 1]} ${year}`
}
