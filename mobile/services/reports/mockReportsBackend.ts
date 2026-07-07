import { Asset } from 'expo-asset';
import type { Report, ReportActivity, ReportComment, ReportsBackend, ReportStatus } from './types';

// In-memory demo backend for the Relatórios slice. Mirrors
// services/profile/mockProfileBackend.ts: a module-level mutable store seeded at
// load, served with a tiny async hop so callers behave like a real network.
// Seed migrated from app/(app)/reports/index.tsx (list) and
// app/(app)/reports/[id].tsx (shared detail fixture). The screens are cleaned
// up in a later unit; they currently keep their own inline copies.

const avatarUri = Asset.fromModule(
  require('../../assets/avatar-construction.png'),
).uri;

// Shared detail fixture — get() of ANY known id returns this enrichment (the
// admin mock does the same: one fixture stands in for per-report detail).
const DETAIL_TEXT = `Este relatório abrange uma análise detalhada da inspeção técnica realizada nas máquinas pesadas da Mina Córrego Seco, com foco especial no equipamento Komatsu 930E. Inclui um checklist abrangente da manutenção preventiva, abordando desde a verificação dos níveis de óleo e filtros até a inspeção de mangueiras e conexões. Além disso, o relatório detalha os reparos necessários identificados durante a inspeção, como a substituição de componentes desgastados, ajustes de sistemas hidráulicos e elétricos, e a correção de soldas defeituosas. O objetivo principal deste relatório é garantir a segurança e a eficiência operacional das máquinas pesadas, minimizando o tempo de inatividade não planejado e prolongando a vida útil dos equipamentos, seguindo as normas de segurança da Vale e as melhores práticas da indústria de mineração.`;

const DETAIL_IMAGES: string[] = [
  Asset.fromModule(require('../../assets/report-image-1.png')).uri,
  Asset.fromModule(require('../../assets/report-image-2.png')).uri,
  Asset.fromModule(require('../../assets/report-image-1.png')).uri,
];

// Converted to the ReportActivity shape: progress 0..1 → 0..100, color → tone
// (primary→success, warning→warning, error→error), avatars → uri strings,
// totalCount → overflowCount.
const DETAIL_ACTIVITIES: ReportActivity[] = [
  { id: 'oleo-filtros', title: 'Verificação de níveis de óleo e filtros', sector: 'Setor Noroeste', progress: 84, tone: 'success', avatars: [avatarUri, avatarUri], overflowCount: 18 },
  { id: 'motores', title: 'Manutenção de motores', sector: 'Setor Noroeste', progress: 84, tone: 'warning', avatars: [avatarUri, avatarUri, avatarUri], overflowCount: 3 },
  { id: 'eletricos', title: 'Ajustes de sistemas elétricos', sector: 'Setor Central', progress: 84, tone: 'error', avatars: [avatarUri, avatarUri, avatarUri], overflowCount: 3 },
];

const SHARED_DETAIL = {
  details: DETAIL_TEXT,
  images: DETAIL_IMAGES,
  activities: DETAIL_ACTIVITIES,
};

const RESPONSIBLES = ['Ana Clara Mendonça', 'Antonio Cláudio Silva', 'Rita Sampaio'];
const SECTOR = 'Setor Noroeste';
const CREATION_DATE = 'dd/mm/aaaa';

// Base list seed (10 items) migrated from app/(app)/reports/index.tsx.
type SeedBase = {
  id: string;
  status: ReportStatus;
  statusLabel: string;
  title: string;
  summary: string;
  authorName: string;
};

const SEED_BASE: SeedBase[] = [
  { id: 'inspecao-tecnica', status: 'accept', statusLabel: 'Concluído', title: 'Inspeção Técnica das Máquinas Pesadas', summary: 'Checklist de manutenção preventiva e reparos necessários', authorName: 'Bianca Rodrigues Lima' },
  { id: 'eficiencia-energetica', status: 'accept', statusLabel: 'Em Revisão', title: 'Relatório de Eficiência Energética da Mina Oeste', summary: 'Avaliação dos consumos e propostas de otimização', authorName: 'Rafael Gomes Pereira' },
  { id: 'qualidade-solo', status: 'accept', statusLabel: 'Em Andamento', title: 'Análise de Qualidade do Solo na Região Sul', summary: 'Verificação dos níveis de nutrientes e contaminantes', authorName: 'Camila Andrade Ribeiro' },
  { id: 'treinamento', status: 'accept', statusLabel: 'Concluído', title: 'Relatório de Treinamento e Capacitação', summary: 'Registro das sessões realizadas e avaliação dos participantes', authorName: 'Gustavo Henrique Alves' },
  { id: 'impacto-ambiental', status: 'canceled', statusLabel: 'Pendência', title: 'Avaliação de Impacto Ambiental da Mina Central', summary: 'Identificação de áreas críticas para preservação ecológica', authorName: 'Lucas Almeida Ferreira' },
  { id: 'riscos-geologicos', status: 'pending', statusLabel: 'Em Revisão', title: 'Estudo de Riscos Geológicos na Região Centro', summary: 'Mapeamento de falhas e zonas instáveis', authorName: 'Larissa Fernandes Melo' },
  { id: 'produtividade-oeste', status: 'canceled', statusLabel: 'Concluído', title: 'Relatório de Produtividade da Mina Oeste', summary: 'Comparativo da produção mensal e fatores influenciadores', authorName: 'Eduardo Silva Costa' },
  { id: 'custos-operacionais', status: 'canceled', statusLabel: 'Pendência', title: 'Análise de Custos Operacionais da Mina Leste', summary: 'Projeção de despesas e sugestões de redução', authorName: 'Isabela Martins Souza' },
  { id: 'hidrologia-leste', status: 'pending', statusLabel: 'Concluído', title: 'Monitoramento Hidrológico da Zona Leste', summary: 'Status dos corpos hídricos e análise de contaminação', authorName: 'Fernanda Marques Silva' },
  { id: 'meteorologia-norte', status: 'pending', statusLabel: 'Pendência', title: 'Relatório de Condições Meteorológicas na Área Norte', summary: 'Registro das variações climáticas e impacto operacional', authorName: 'Thiago Moura Santos' },
];

function enrich(base: SeedBase): Report {
  return {
    ...base,
    authorAvatarUri: avatarUri,
    creationDate: CREATION_DATE,
    sector: SECTOR,
    responsibles: RESPONSIBLES,
    ...SHARED_DETAIL,
    comments: [],
  };
}

// dd/mm/aaaa — matches the demo's creationDate format.
function formatDate(d: Date): string {
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}/${mm}/${yyyy}`;
}

// Newest first: created reports are unshifted, so iteration order is the list.
let store: Report[] = SEED_BASE.map(enrich);

const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

export const mockReportsBackend: ReportsBackend = {
  async list() {
    await tick();
    return store.map((r) => ({ ...r }));
  },
  async get(id) {
    await tick();
    const found = store.find((r) => r.id === id);
    return found ? { ...found } : null;
  },
  async create(input) {
    await tick();
    const report: Report = {
      id: `local-${Date.now()}`,
      title: input.title,
      summary: input.summary,
      status: 'pending',
      statusLabel: 'Em Revisão',
      authorName: 'Você',
      authorAvatarUri: avatarUri,
      creationDate: formatDate(new Date()),
      sector: SECTOR,
      responsibles: input.responsibles,
      details: input.details,
      images: input.imageUris,
      activities: [],
      comments: [],
    };
    store = [report, ...store];
    return { ...report };
  },
  // PATCH parcial in-memory: só os campos presentes sobrescrevem (paridade
  // com o UpdateReportDto do backend). Imagens ficam fora da edição (ver
  // nota no ReportUpdateInput) — preservadas intactas.
  async update(id, input) {
    await tick();
    const idx = store.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const prev = store[idx];
    const next: Report = {
      ...prev,
      ...(input.title !== undefined ? { title: input.title } : null),
      ...(input.summary !== undefined ? { summary: input.summary } : null),
      ...(input.details !== undefined ? { details: input.details } : null),
      ...(input.responsibles !== undefined ? { responsibles: input.responsibles } : null),
    };
    store = store.map((r, i) => (i === idx ? next : r));
    return { ...next };
  },
  async addComment(id, text) {
    await tick();
    const idx = store.findIndex((r) => r.id === id);
    if (idx < 0) return null;
    const comment: ReportComment = {
      id: `comment-${Date.now()}`,
      authorName: 'Você',
      authorAvatarUri: avatarUri,
      text,
      date: formatDate(new Date()),
    };
    store = store.map((r, i) =>
      i === idx ? { ...r, comments: [...r.comments, comment] } : r,
    );
    return { ...comment };
  },
};
