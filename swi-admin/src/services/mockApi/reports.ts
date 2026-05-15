// src/services/mockApi/reports.ts
// Mock reports for /reports (Figma 96:4091). 12 cards arranged 4×3 with
// title, summary, author, status and sector. Statuses map to the DS
// StatusTag values: 'accept' (green), 'pending' (yellow), 'canceled' (red).
import { sleep } from './sleep'
import type { MockResponse } from './types'
import workerA from '@/assets/avatars/worker-a.png'
import workerB from '@/assets/avatars/worker-b.png'
import workerC from '@/assets/avatars/worker-c.png'
// "Imagens" section on /reports/:id — real inspection photos (Figma).
import inspection1 from '@/assets/reports/inspection-1.png'
import inspection2 from '@/assets/reports/inspection-2.png'
import inspection3 from '@/assets/reports/inspection-3.png'

export type ReportStatus = 'accept' | 'pending' | 'canceled' | 'info'

// One activity row on /reports/:id (Figma 98:4877 "Atividades" section).
// Row renders: wrench icon | vertical divider | title + sector + ProgressBar |
// AvatarGroup (count) | location_on icon. Progress tone colors the bar:
// success (green), warning (orange), error (red).
export type ReportActivity = {
  id: string
  title: string
  sector: string
  progress: number
  tone: 'success' | 'warning' | 'error'
  avatars: ReadonlyArray<string>
  overflowCount?: number
}

export type Report = {
  id: string
  title: string
  summary: string
  status: ReportStatus
  statusLabel: string
  authorName: string
  authorAvatarUri: string
  creationDate: string
  sector: string
  // Comma-separated list of responsibles — rendered in the
  // "Responsáveis" section at the bottom of the card (Figma Report Card).
  responsibles: string
  // Details body shown on /reports/:id (Figma 98:4877 "Detalhes do relatório").
  details?: string
  // Image thumbnails for the "Imagens" section. Reuse mock photos until
  // real uploads are wired.
  images?: ReadonlyArray<string>
  // Activities list for the "Atividades" section.
  activities?: ReadonlyArray<ReportActivity>
}

const REPORTS_SEED: ReadonlyArray<Report> = [
  {
    id: 'r-01',
    title: 'Inspeção Técnica das Máquinas Pesadas',
    summary: 'Checklist de manutenção preventiva e reparos necessários nos equipamentos da frota.',
    status: 'pending',
    statusLabel: 'Em Revisão',
    authorName: 'Eduardo Henriques Rodrigues',
    authorAvatarUri: workerA,
    creationDate: '12/04/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-02',
    title: 'Relatório de Eficiência Energética da Mina Oeste',
    summary: 'Análise de consumo e indicadores de eficiência energética por turno e equipamento.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Mariana Pinto',
    authorAvatarUri: workerB,
    creationDate: '08/04/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-03',
    title: 'Análise de Qualidade do Solo na Região Sul',
    summary: 'Resultados de amostragem geoquímica para validar qualidade do solo na nova frente.',
    status: 'info',
    statusLabel: 'Em Andamento',
    authorName: 'Ana Clara Mendonça',
    authorAvatarUri: workerC,
    creationDate: '02/04/2026',
    sector: 'Setor Sul',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-04',
    title: 'Relatório de Treinamento e Capacitação',
    summary: 'Resumo das ações de treinamento realizadas e avaliação dos participantes do mês.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Isabela Antônio',
    authorAvatarUri: workerA,
    creationDate: '28/03/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-05',
    title: 'Avaliação de Impacto Ambiental da Mina Central',
    summary: 'Identificação das principais frentes de impacto ambiental e plano de mitigação.',
    status: 'pending',
    statusLabel: 'Em Revisão',
    authorName: 'Lucas Almeida Silva',
    authorAvatarUri: workerB,
    creationDate: '25/03/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-06',
    title: 'Estudo de Riscos Geológicos da Região Centro',
    summary: 'Mapeamento de falhas e áreas com risco geotécnico identificadas no semestre.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Ana Clara Mendonça',
    authorAvatarUri: workerC,
    creationDate: '18/03/2026',
    sector: 'Setor Centro',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-07',
    title: 'Relatório de Produtividade da Mina Oeste',
    summary: 'Compara projeção de produção com volume realizado nos últimos três meses.',
    status: 'info',
    statusLabel: 'Em Andamento',
    authorName: 'Ana Clara Mendonça',
    authorAvatarUri: workerA,
    creationDate: '12/03/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-08',
    title: 'Análise de Custos Operacionais da Mina Leste',
    summary: 'Levantamento de custos diretos e indiretos, com sugestão de cortes para Q2.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Lucas Almeida Silva',
    authorAvatarUri: workerB,
    creationDate: '04/03/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-09',
    title: 'Monitoramento Hidrológico da Zona Leste',
    summary: 'Dados dos sensores hidrológicos e variações observadas nas últimas duas semanas.',
    status: 'pending',
    statusLabel: 'Em Revisão',
    authorName: 'Fernanda Macedo',
    authorAvatarUri: workerC,
    creationDate: '25/02/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-10',
    title: 'Relatório de Condições Meteorológicas da Mina Norte',
    summary: 'Compilação de dados meteorológicos e impacto nas operações da última quinzena.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Mariana Pinto',
    authorAvatarUri: workerA,
    creationDate: '20/02/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-11',
    title: 'Relatório de Segurança da Planta Sul',
    summary: 'Análise dos protocolos de segurança aplicados e ocorrências reportadas no mês.',
    status: 'info',
    statusLabel: 'Em Andamento',
    authorName: 'Ana Clara Mendonça',
    authorAvatarUri: workerB,
    creationDate: '15/02/2026',
    sector: 'Setor Sul',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
  {
    id: 'r-12',
    title: 'Relatório de Sustentabilidade Corporativa',
    summary: 'Indicadores ESG do trimestre, metas atingidas e ações para os próximos ciclos.',
    status: 'accept',
    statusLabel: 'Concluído',
    authorName: 'Felipe Bessa',
    authorAvatarUri: workerC,
    creationDate: '10/02/2026',
    sector: 'Setor Nordeste',
    responsibles: 'Ana Clara Mendonça, Antonio Hayde',
  },
]

export const REPORTS_TOTAL = REPORTS_SEED.length

// Demo fixture for /reports/:id — same details for every report so any card
// click opens a fully-populated page (Figma 98:4877).
const DEMO_DETAILS = {
  details:
    'Inspeção realizada nas máquinas pesadas da Mina Córrego Seco, com foco especial no equipamento Komatsu K35E. Inicia o checklist abrangente de manutenção preventiva, abordando desde a verificação dos níveis de óleo e filtros até a substituição de componentes desgastados. A equipe técnica também realizou ajustes de calibração nos sistemas hidráulicos e elétricos, garantindo o desempenho ótimo dos equipamentos. Foram identificadas e corrigidas pequenas falhas no sistema de ignição de uma das escavadeiras, contribuindo para sua eficiência operacional aprimorada. Adicionalmente, foi realizada uma verificação minuciosa nos pneus, monitorando o desgaste e a pressão para garantir a segurança e o bom funcionamento das máquinas em todas as operações de mineração.',
  images: [inspection1, inspection2, inspection3],
  activities: [
    {
      id: 'act-01',
      title: 'Verificação de níveis de óleo e filtros',
      sector: 'Setor Noroeste',
      progress: 80,
      tone: 'success' as const,
      avatars: [workerA, workerB, workerC, workerA, workerB],
      overflowCount: 13,
    },
    {
      id: 'act-02',
      title: 'Manutenção de motores',
      sector: 'Setor Noroeste',
      progress: 50,
      tone: 'warning' as const,
      avatars: [workerC, workerA, workerB],
    },
    {
      id: 'act-03',
      title: 'Ajustes de sistemas elétricos',
      sector: 'Setor Central',
      progress: 30,
      tone: 'error' as const,
      avatars: [workerC, workerA],
    },
  ] as ReadonlyArray<ReportActivity>,
}

export const reportsApi = {
  async list(): Promise<MockResponse<ReadonlyArray<Report>>> {
    await sleep(100)
    return { data: REPORTS_SEED, error: null }
  },
  async get(id: string): Promise<MockResponse<Report | null>> {
    await sleep(80)
    const base = REPORTS_SEED.find((r) => r.id === id) ?? null
    if (!base) return { data: null, error: null }
    return { data: { ...base, ...DEMO_DETAILS }, error: null }
  },
}
