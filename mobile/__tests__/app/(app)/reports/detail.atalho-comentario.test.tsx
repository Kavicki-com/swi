import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { TextInput } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import ReportDetails from '../../../../app/(app)/reports/[id]';
import type { Report } from '../../../../services/reports/types';

// O "Fazer comentário" da linha de ações, no topo do detalhe, não fazia nada.
// O campo de comentário fica no fim da tela, depois de detalhes, imagens e
// atividades: o atalho leva a pessoa até ele, com o teclado aberto. O envio
// continua sendo o do botão do rodapé.

jest.mock('expo-router', () => ({
  useLocalSearchParams: () => ({ id: 'r1' }),
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('../../../../lib/media/trustedMediaUrl', () => ({
  abrirAnexoOuAvisar: jest.fn(),
}));

const mockRelatorio: Report = {
  id: 'r1',
  title: 'Inspecao das maquinas pesadas',
  summary: 'Checklist de manutencao preventiva.',
  status: 'pending',
  statusLabel: 'Em Revisao',
  authorName: 'Josue Oliveira',
  authorAvatarUri: '',
  creationDate: '12/04/2026',
  sector: 'Setor Nordeste',
  responsibles: ['Ezequiel Almeida'],
  details: 'Inspecao realizada nas maquinas pesadas.',
  images: [],
  attachments: [],
  activities: [],
  comments: [],
};

// Dublês estáveis entre renders: o detalhe relê quando `loadOne` muda de
// identidade, e uma função nova a cada render releria sem parar.
const mockReports = {
  loadOne: () => Promise.resolve(mockRelatorio),
  addComment: jest.fn(),
  commentsFor: () => ({ sent: [], pending: [] }),
};
jest.mock('../../../../services/reports/ReportsProvider', () => ({
  useReports: () => mockReports,
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const montar = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <ReportDetails />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// O rótulo "Fazer comentário" aparece duas vezes: no atalho (outline, no topo)
// e no envio (contained, no rodapé). A variante separa um do outro.
const atalho = (tree: ReactTestRenderer) =>
  tree.root.findAll(
    (n) =>
      n.props?.label === 'Fazer comentário' &&
      n.props?.variant === 'outline' &&
      typeof n.props?.onPress === 'function',
  )[0];

const campoDoComentario = (tree: ReactTestRenderer) => {
  const input = tree.root.findAll(
    (n) => n.props?.label === 'Adicionar comentário' && typeof n.props?.onChangeText === 'function',
  )[0];
  return input.findByType(TextInput).instance as { focus: () => void };
};

describe('Detalhe do relatório: atalho para comentar', () => {
  it('o Fazer comentário do topo põe o foco no campo de comentário', async () => {
    const tree = await montar();
    const campo = campoDoComentario(tree);
    const focus = jest.spyOn(campo, 'focus');

    act(() => atalho(tree).props.onPress());

    expect(focus).toHaveBeenCalledTimes(1);
  });

  it('o atalho não envia nada: sem texto, o envio do rodapé segue desligado', async () => {
    const tree = await montar();

    act(() => atalho(tree).props.onPress());

    const envio = tree.root.findAll(
      (n) => n.props?.variant === 'contained' && typeof n.props?.onPress === 'function',
    )[0];
    expect(envio.props.disabled).toBe(true);
  });
});
