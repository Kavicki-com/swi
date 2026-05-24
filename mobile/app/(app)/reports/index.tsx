import { memo, useCallback, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  JourneyTheme,
  Pagination,
  ReportCard,
  SearchInput,
  type StatusTagStatus,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../../components/NavFABs';

// Figma 364:18596 — reports list. SearchInput + Novo relatório CTA +
// scrollable ReportCard list + Pagination + 2 FABs (chat + home).
// Demo phase: 10 mock reports keyed by id, todos navegam pra
// /reports/[id] (stub Phase 2).

const avatarUri = Asset.fromModule(
  require('../../../assets/avatar-construction.png'),
).uri;

type ReportItem = {
  id: string;
  status: StatusTagStatus;
  statusLabel: string;
  title: string;
  summary: string;
  authorName: string;
};

const REPORTS: ReportItem[] = [
  {
    id: 'inspecao-tecnica',
    status: 'accept',
    statusLabel: 'Concluído',
    title: 'Inspeção Técnica das Máquinas Pesadas',
    summary: 'Checklist de manutenção preventiva e reparos necessários',
    authorName: 'Bianca Rodrigues Lima',
  },
  {
    id: 'eficiencia-energetica',
    status: 'accept',
    statusLabel: 'Em Revisão',
    title: 'Relatório de Eficiência Energética da Mina Oeste',
    summary: 'Avaliação dos consumos e propostas de otimização',
    authorName: 'Rafael Gomes Pereira',
  },
  {
    id: 'qualidade-solo',
    status: 'accept',
    statusLabel: 'Em Andamento',
    title: 'Análise de Qualidade do Solo na Região Sul',
    summary: 'Verificação dos níveis de nutrientes e contaminantes',
    authorName: 'Camila Andrade Ribeiro',
  },
  {
    id: 'treinamento',
    status: 'accept',
    statusLabel: 'Concluído',
    title: 'Relatório de Treinamento e Capacitação',
    summary: 'Registro das sessões realizadas e avaliação dos participantes',
    authorName: 'Gustavo Henrique Alves',
  },
  {
    id: 'impacto-ambiental',
    status: 'canceled',
    statusLabel: 'Pendência',
    title: 'Avaliação de Impacto Ambiental da Mina Central',
    summary: 'Identificação de áreas críticas para preservação ecológica',
    authorName: 'Lucas Almeida Ferreira',
  },
  {
    id: 'riscos-geologicos',
    status: 'pending',
    statusLabel: 'Em Revisão',
    title: 'Estudo de Riscos Geológicos na Região Centro',
    summary: 'Mapeamento de falhas e zonas instáveis',
    authorName: 'Larissa Fernandes Melo',
  },
  {
    id: 'produtividade-oeste',
    status: 'canceled',
    statusLabel: 'Concluído',
    title: 'Relatório de Produtividade da Mina Oeste',
    summary: 'Comparativo da produção mensal e fatores influenciadores',
    authorName: 'Eduardo Silva Costa',
  },
  {
    id: 'custos-operacionais',
    status: 'canceled',
    statusLabel: 'Pendência',
    title: 'Análise de Custos Operacionais da Mina Leste',
    summary: 'Projeção de despesas e sugestões de redução',
    authorName: 'Isabela Martins Souza',
  },
  {
    id: 'hidrologia-leste',
    status: 'pending',
    statusLabel: 'Concluído',
    title: 'Monitoramento Hidrológico da Zona Leste',
    summary: 'Status dos corpos hídricos e análise de contaminação',
    authorName: 'Fernanda Marques Silva',
  },
  {
    id: 'meteorologia-norte',
    status: 'pending',
    statusLabel: 'Pendência',
    title: 'Relatório de Condições Meteorológicas na Área Norte',
    summary: 'Registro das variações climáticas e impacto operacional',
    authorName: 'Thiago Moura Santos',
  },
];

const RESPONSIBLES = 'Ana Clara Mendonça, Antonio Cláudio Silva, Rita Sampaio,';
const LOCATION = 'Setor Noroeste';
const CREATION_DATE = 'dd/mm/aaaa';

// T5.2: ReportRow memoizado pra impedir que os 10 cards re-renderizem quando
// search/currentPage mudam. onPress(id) é estável via useCallback no parent.
type ReportRowProps = {
  report: ReportItem;
  onPress: (id: string) => void;
};
const ReportRow = memo(function ReportRow({ report, onPress }: ReportRowProps) {
  const handlePress = useCallback(() => onPress(report.id), [report.id, onPress]);
  return (
    <ReportCard
      status={report.status}
      statusLabel={report.statusLabel}
      title={report.title}
      summary={report.summary}
      creationDate={CREATION_DATE}
      author={{ name: report.authorName, avatarUri }}
      location={LOCATION}
      responsibles={RESPONSIBLES}
      fullWidth
      onPress={handlePress}
    />
  );
});

export default function Reports() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // T5.2: useCallback estabiliza ref → ReportRow memo consegue skipar
  // re-render quando search/currentPage mudam.
  const handleReportPress = useCallback(
    (id: string) => router.push({ pathname: '/(app)/reports/[id]', params: { id } }),
    [router],
  );

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/login-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

      {/* Fixed header: SearchInput + Novo relatório CTA stay pinned at top.
          Figma 364:18596 mostra apenas 1 e meio card na área scrollável.
          `paddingTop` mínimo de 40 garante o respiro visto no Figma mesmo
          no web (onde `insets.top` = 0). */}
      <View
        style={{
          paddingTop: Math.max(insets.top, 40),
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
      >
        <SearchInput
          value={search}
          onChangeText={setSearch}
          placeholder="Pesquisar relatório"
        />

        <Button
          variant="contained"
          backgroundColor={theme.surface.primary}
          labelColor={theme.content.light}
          label="Novo relatório"
          elevation="lg"
          iconLeft={<Icon name="add_circle" size={20} color={theme.content.light} />}
          accessibilityLabel="Novo relatório"
          onPress={() => router.push('/(app)/reports/new')}
        />
      </View>

      {/* Scrollable cards area — altura calibrada para mostrar 1 card cheio
          + 2º card cortado logo após o Resumo completo (request do cliente
          2026-05-22: "deixe apenas até o resumo completo e corte"). maxHeight
          540 expõe status, título e resumo do card 2 sem mostrar data/autor. */}
      <ScrollView
        style={{ maxHeight: 540, marginTop: theme.gap.m }}
        contentContainerStyle={{
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
          paddingBottom: theme.padding.l,
        }}
        showsVerticalScrollIndicator={false}
      >
        {REPORTS.map((report) => (
          <ReportRow
            key={report.id}
            report={report}
            onPress={handleReportPress}
          />
        ))}

        {/* Pagination — Figma 461:10196 (shared with settings/faq.tsx) */}
        <Pagination
          currentPage={currentPage}
          onPageChange={setCurrentPage}
        />
      </ScrollView>

      <NavFABs />
    </View>
  );
}
