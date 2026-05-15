import { useState } from 'react';
import { Image as RNImage, ScrollView, View } from 'react-native';
import { Asset } from 'expo-asset';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Button,
  Icon,
  ReportCard,
  SearchInput,
  type StatusTagStatus,
  useTheme,
} from '@kavicki/swi-design-system';

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

export default function Reports() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [currentPage, setCurrentPage] = useState(1);

  return (
    <View style={{ flex: 1, backgroundColor: theme.background }}>
      <View
        pointerEvents="none"
        style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 }}
      >
        <RNImage
          source={require('../../../assets/reports-bg.png')}
          resizeMode="cover"
          accessible={false}
          style={{ width: '100%', height: '100%' }}
        />
      </View>

      <ScrollView
        style={{ flex: 1, backgroundColor: 'transparent' }}
        contentContainerStyle={{
          paddingTop: insets.top,
          paddingBottom: insets.bottom + 160,
          paddingHorizontal: theme.padding.m,
          gap: theme.gap.m,
        }}
        showsVerticalScrollIndicator={false}
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
          iconLeft={<Icon name="add" size={24} color={theme.content.light} />}
          accessibilityLabel="Novo relatório"
          onPress={() => router.push('/(app)/reports/new')}
        />

        {/* Reports list */}
        {REPORTS.map((report) => (
          <ReportCard
            key={report.id}
            status={report.status}
            statusLabel={report.statusLabel}
            title={report.title}
            summary={report.summary}
            creationDate={CREATION_DATE}
            author={{ name: report.authorName, avatarUri }}
            location={LOCATION}
            responsibles={RESPONSIBLES}
            fullWidth
            onPress={() =>
              router.push({
                pathname: '/(app)/reports/[id]',
                params: { id: report.id },
              })
            }
          />
        ))}

        {/* Pagination — Figma 461:10196 (mesmo pattern do faq) */}
        <View
          style={{
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 10,
          }}
        >
          {[1, 2, 3, 4].map((n) => (
            <View key={n} style={{ flex: 1 }}>
              <Button
                variant="ghost"
                label={String(n)}
                accessibilityLabel={`Página ${n}`}
                onPress={() => setCurrentPage(n)}
              />
            </View>
          ))}
          <View style={{ flex: 1 }}>
            <Button
              variant="ghost"
              label="..."
              accessibilityLabel="Mais páginas"
              onPress={() => {}}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Button
              variant="contained"
              backgroundColor={theme.surface.primary}
              accessibilityLabel="Próxima página"
              onPress={() => setCurrentPage((p) => p + 1)}
              iconLeft={
                <Icon
                  name="keyboard_arrow_right"
                  width={7.4}
                  height={12}
                  color={theme.content.light}
                />
              }
            />
          </View>
        </View>
      </ScrollView>

      {/* Chat FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          right: theme.padding.m,
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.surface.success}
          elevation="lg"
          iconLeft={
            <Icon
              name="chat_bubble"
              width={25.714}
              height={25.714}
              color={theme.content.light}
            />
          }
          accessibilityLabel="Abrir chat"
          onPress={() => router.push('/(app)/chat/inbox')}
        />
      </View>

      {/* Home FAB */}
      <View
        pointerEvents="box-none"
        style={{
          position: 'absolute',
          bottom: insets.bottom + theme.gap.l,
          left: 0,
          right: 0,
          alignItems: 'center',
        }}
      >
        <Button
          variant="contained"
          shape="pill"
          size="xlarge"
          backgroundColor={theme.content.dark}
          borderColor={theme.content.disable}
          borderWidth={10}
          elevation="lg"
          iconLeft={
            <Icon
              name="home"
              width={28.286}
              height={25.458}
              color={theme.surface.standard}
            />
          }
          accessibilityLabel="Voltar para a dashboard"
          onPress={() => router.push('/(app)/dashboard')}
        />
      </View>
    </View>
  );
}
