// Demo task data shared across all 4 journey screens (index, ongoing,
// pause, task/[id]). Each was previously redeclaring the same 4 tasks
// (inspecao, manutencao, diagnostico, reparo) verbatim. Extracted per
// the "duplicação massiva" cleanup item in 2026-05-17-mobile-routes-audit.md.
//
// Usage:
//   - journey/index            → TASKS (full list)
//   - journey/ongoing & pause  → ACTIVE_TASK + UPCOMING_TASKS
//   - journey/task/[id]        → findTaskById(id) ?? FALLBACK_TASK

export interface JourneyTask {
  id: string;
  title: string;
  description: string;
}

export const TASKS: ReadonlyArray<JourneyTask> = [
  {
    id: 'inspecao',
    title: 'Inspeção de Equipamentos',
    description:
      'Realizar verificações periódicas para identificar desgastes ou falhas em máquinas industriais.',
  },
  {
    id: 'manutencao',
    title: 'Manutenção Preventiva',
    description:
      'Executar tarefas programadas para evitar paradas não planejadas e aumentar a vida útil dos equipamentos.',
  },
  {
    id: 'diagnostico',
    title: 'Diagnóstico de Falhas',
    description:
      'Analisar problemas técnicos e determinar as causas de mau funcionamento nas máquinas.',
  },
  {
    id: 'reparo',
    title: 'Reparo de Componentes',
    description:
      'Substituir ou consertar peças defeituosas para restaurar o funcionamento adequado dos equipamentos.',
  },
];

export const ACTIVE_TASK: JourneyTask = TASKS[0];
export const UPCOMING_TASKS: ReadonlyArray<JourneyTask> = TASKS.slice(1);

export const FALLBACK_TASK: JourneyTask = TASKS[0];

export function findTaskById(id: string | undefined): JourneyTask | undefined {
  if (!id) return undefined;
  return TASKS.find((t) => t.id === id);
}
