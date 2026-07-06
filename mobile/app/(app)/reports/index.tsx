import { memo, useCallback, useEffect, useState } from 'react';
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

// Figma 364:18596 — reports list. SearchInput + Novo relatório CTA +
// scrollable ReportCard list + Pagination + 2 FABs (chat + home).
// Backend slice: 10 mock reports via useReports() (Unit A/B), todos navegam
// pra /reports/[id]. Mesmos dados que antes (seed migrado das telas).

// T5.2: ReportRow memoizado pra impedir que os cards re-renderizem quando
// search/page mudam. onPress(id) é estável via useCallback no parent.
type ReportRowProps = {
  report: Report;
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
  const { reports, status, load, page, pageCount } = useReports();
  const [search, setSearch] = useState('');

  // Só carrega quando ainda não há nada carregado (status 'idle'). load() seta
  // 'loading' primeiro, então re-disparar em todo mount apagaria a lista já
  // populada pra um spinner ao voltar pra tela. O provider mantém `reports` na
  // sessão e create() o mantém fresco, então visitas seguintes não dão flash.
  useEffect(() => {
    if (status === 'idle') load(1);
  }, [status, load]);

  // T5.2: useCallback estabiliza ref → ReportRow memo consegue skipar
  // re-render quando search/page mudam.
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

      {status === 'loading' || status === 'idle' ? (
        <ReportsListState kind="loading" />
      ) : status === 'empty' ? (
        <ReportsListState kind="empty" />
      ) : status === 'error' ? (
        <ReportsListState kind="error" onRetry={() => load(page)} />
      ) : (
        <>
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
            {reports.map((report) => (
              <ReportRow
                key={report.id}
                report={report}
                onPress={handleReportPress}
              />
            ))}

            {/* Pager numerado — Figma 461:10196. currentPage/pageCount reais do provider;
                onPageChange recarrega a página. Escondido quando só há 1 página (um pager
                de 1 página é ruído). Clamp Math.min(...,pageCount) neutraliza o overflow do
                chevron "→" na última página. */}
            {pageCount > 1 && (
              <Pagination
                currentPage={page}
                pageCount={pageCount}
                onPageChange={(p) => load(Math.min(Math.max(p, 1), pageCount))}
              />
            )}
          </ScrollView>
        </>
      )}

      <NavFABs />
    </View>
  );
}
