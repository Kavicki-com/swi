// Demo task data shared across journey screens. Originalmente 4 screens
// (index, ongoing, pause, task/[id]) — após Escopo B (2026-05-21) que
// eliminou ongoing/pause como rotas, sobrou apenas index + task/[id].
//
// Usage:
//   - journey/index      → TASKS (full list)
//   - journey/task/[id]  → findTaskById(id) ?? FALLBACK_TASK

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

export const FALLBACK_TASK: JourneyTask = TASKS[0];

export function findTaskById(id: string | undefined): JourneyTask | undefined {
  if (!id) return undefined;
  return TASKS.find((t) => t.id === id);
}
