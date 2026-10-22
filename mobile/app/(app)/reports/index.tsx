import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ScrollView, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  JourneyTheme,
  Pagination,
  ReportCard,
  SearchInput,
  useTheme,
} from '@kavicki/swi-design-system';
import { NavFABs } from '../../../components/NavFABs';
import { ReportsListState } from '../../../components/reports/ReportsListState';
import { useReports } from '../../../services/reports/ReportsProvider';
import type { Report } from '../../../services/reports/types';

// scrollable ReportCard list + Pagination + 2 FABs (chat + home).
// Todos os cartões do servidor navegam pra /reports/[id].
//
// Busca e paginação acontecem sobre a lista já carregada: o backend não busca
// por texto e devolve a lista da empresa numa leitura só. A busca é pelo
// título, como no painel.
const PAGE_SIZE = 10;

const matches = (report: Report, query: string) =>
  report.title.toLowerCase().includes(query);

// T5.2: ReportRow memoizado pra impedir que os 10 cards re-renderizem quando
// search/currentPage mudam. onPress(id) é estável via useCallback no parent.
// `onPress` ausente = cartão que não abre: é o relatório ainda na fila de
// envios, que não existe no servidor e não tem detalhe para mostrar.
type ReportRowProps = {
  report: Report;
  onPress?: (id: string) => void;
};
const ReportRow = memo(function ReportRow({ report, onPress }: ReportRowProps) {
  const handlePress = useMemo(
    () => (onPress ? () => onPress(report.id) : undefined),
    [report.id, onPress],
  );
  return (
    <ReportCard
      status={report.status}
      statusLabel={report.statusLabel}
      title={report.title}
      summary={report.summary}
      creationDate={report.creationDate}
      author={{ name: report.authorName, avatarUri: report.authorAvatarUri }}
      location={report.sector}
      responsibles={report.responsibles.join(', ')}
      fullWidth
      onPress={handlePress}
    />
  );
});

export default function Reports() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { reports, pendingReports, status, load } = useReports();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  // Só carrega quando ainda não há nada carregado (status 'idle'). load() seta
  // populada pra um spinner ao voltar pra tela. O provider mantém `reports` na
  // sessão e create() o mantém fresco, então visitas seguintes não dão flash.
  useEffect(() => {
    if (status === 'idle') load();
  }, [status, load]);

  // T5.2: useCallback estabiliza ref → ReportRow memo consegue skipar
  // re-render quando search/currentPage mudam.
  const handleReportPress = useCallback(
    (id: string) => router.push({ pathname: '/(app)/reports/[id]', params: { id } }),
    [router],
  );
  const openNewReport = useCallback(() => router.push('/(app)/reports/new'), [router]);

  // A página nova começa do primeiro cartão, não da rolagem da anterior.
  const scrollRef = useRef<ScrollView>(null);
  const changePage = useCallback((n: number) => {
    setCurrentPage(n);
    scrollRef.current?.scrollTo?.({ y: 0, animated: false });
  }, []);

  // Buscar recomeça da primeira página: a página em que a pessoa estava pode
  // nem existir no resultado.
  const handleSearch = useCallback((text: string) => {
    setSearch(text);
    setCurrentPage(1);
  }, []);

  // Os que aguardam envio vêm primeiro (são os mais novos) e não abrem
  // detalhe. Sem a lista do servidor, só eles entram na conta.
  const rows = useMemo(() => {
    const query = search.trim().toLowerCase();
    const all = [
      ...pendingReports.map((report) => ({ report, opens: false })),
      ...(status === 'error' ? [] : reports.map((report) => ({ report, opens: true }))),
    ];
    return query ? all.filter(({ report }) => matches(report, query)) : all;
  }, [pendingReports, reports, status, search]);

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  // A lista pode encolher com a página aberta (um pendente confirmado sai da
  // fila): a página mostrada nunca passa da última.
  const page = Math.min(currentPage, pageCount);
  // Sem a lista do servidor não há paginação na tela: os pendentes vão todos.
  const visible =
    status === 'error' ? rows : rows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <JourneyTheme
        gradient={require('../../../assets/login-bg.png')}
        pattern={require('../../../assets/smartband-bg-pattern.png')}
      />

      {status === 'loading' || status === 'idle' ? (
        <ReportsListState kind="loading" />
      ) : status === 'empty' && pendingReports.length === 0 ? (
        <ReportsListState kind="empty" onCreate={openNewReport} />
      ) : (
        <>
          <View
            style={{
              paddingTop: Math.max(insets.top, 40),
              paddingHorizontal: theme.padding.m,
              gap: theme.gap.m,
            }}
          >
            <SearchInput
              value={search}
              onChangeText={handleSearch}
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
              onPress={openNewReport}
            />
          </View>

          <ScrollView
            ref={scrollRef}
            style={{ flex: 1, marginTop: theme.gap.m }}
            contentContainerStyle={{
              paddingHorizontal: theme.padding.m,
              gap: theme.gap.m,
              paddingBottom: theme.padding.l,
            }}
            showsVerticalScrollIndicator={false}
          >
            {visible.map(({ report, opens }) => (
              <ReportRow
                key={report.id}
                report={report}
                onPress={opens ? handleReportPress : undefined}
              />
            ))}
            {/* Sem a lista do servidor (o app abriu sem sinal), a falha fica
                no lugar dela: a busca, o "Novo relatório" e os pendentes
                continuam usáveis. */}
            {status === 'error' ? <ReportsListState kind="error" onRetry={load} /> : null}
          </ScrollView>

          <View
            style={{
              paddingHorizontal: theme.padding.m,
              paddingTop: theme.gap.sm,
              paddingBottom: insets.bottom + 127 + theme.gap.m,
            }}
          >
            {status === 'error' ? null : (
              <Pagination
                currentPage={page}
                pageCount={pageCount}
                onPageChange={changePage}
              />
            )}
          </View>
        </>
      )}

      <NavFABs />
    </View>
  );
}
