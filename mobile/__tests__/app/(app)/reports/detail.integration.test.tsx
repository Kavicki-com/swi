import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ReportDetails from '../../../../app/(app)/reports/[id]';
import { ReportsProvider } from '../../../../services/reports/ReportsProvider';
import { apiRequest } from '../../../../services/api/http';

// O QUE ESTE ARQUIVO COBRE, e o apiReportsBackend.test.ts nao:
//
// La o adaptador e verificado contra a ideia que o teste tem da tela. Aqui a
// TELA roda com o adaptador e o provider DE VERDADE, e a unica ponta dublada e
// o HTTP. E a unica montagem que reproduz o QA Mobile #9 como o usuario viu:
// abrir um relatorio do servidor e o app fechar.

jest.mock('../../../../services/api/http', () => ({ apiRequest: jest.fn() }));
jest.mock('../../../../services/api/uploadMedia', () => ({ uploadImage: jest.fn() }));

// Provider real + adaptador real: o seletor honra DATA_BACKEND, e o teste
// precisa do caminho 'api' independente da env em que a suite roda.
jest.mock('../../../../services/reports/getReportsBackend', () => ({
  getReportsBackend: () =>
    require('../../../../services/reports/apiReportsBackend').apiReportsBackend,
}));

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

// Resposta REAL do GET /reports/:id (ReportsService.toDto + get): a atividade
// vem com responsibleNames/responsibleAvatars e SEM id nem `avatars`. Todo
// relatorio do seed tem as 3 atividades, entao "qualquer relatorio" fechava.
const WIRE_DETAIL = {
  id: 'r1',
  title: 'Inspecao Tecnica das Maquinas Pesadas',
  summary: 'Checklist de manutencao preventiva.',
  status: 'pending',
  statusLabel: 'Em Revisao',
  authorName: 'Josue Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ezequiel Almeida', 'Romulo Cardoso'],
  responsibleAvatars: ['signed:ezequiel', ''],
  details: 'Inspecao realizada nas maquinas pesadas.',
  images: [],
  imageKeys: [],
  activities: [
    {
      title: 'Verificacao de niveis de oleo e filtros',
      sector: 'Setor Noroeste',
      progress: 80,
      tone: 'success',
      responsibleNames: ['Josue Oliveira', 'Ezequiel Almeida'],
      responsibleAvatars: ['signed:josue', ''],
    },
  ],
  comments: [],
};

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ReportsProvider>
            <ReportDetails />
          </ReportsProvider>
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const textos = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.props?.children === 'string')
    .map((n) => n.props.children as string);

beforeEach(() => {
  jest.clearAllMocks();
  (apiRequest as jest.Mock).mockResolvedValue(WIRE_DETAIL);
});

describe('Detalhe do relatorio — QA Mobile #9', () => {
  it('abre um relatorio vindo do servidor sem derrubar a tela', async () => {
    const tree = await render();

    expect(apiRequest).toHaveBeenCalledWith('/reports/r1', { auth: true });
    expect(textos(tree)).toContain('Verificacao de niveis de oleo e filtros');
  });

  it('mostra a equipe real da atividade (as fotos que o servidor resolveu)', async () => {
    const tree = await render();

    const grupo = tree.root.findAll((n) => Array.isArray(n.props?.avatars))[0];
    expect(grupo.props.avatars).toEqual([{ uri: 'signed:josue' }, { uri: '' }]);
  });
});
