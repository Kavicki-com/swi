import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Accordion,
  Pagination,
  SwiThemeProvider,
} from '@kavicki/swi-design-system';
import SettingsFAQ from '../../../../app/(app)/settings/faq';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <SettingsFAQ />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const titulos = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Accordion as React.ComponentType<{ title: string }>)
    .map((a) => a.props.title as string);

const busca = (tree: ReturnType<typeof create>) =>
  tree.root.findAll(
    (n) => n.props?.placeholder === 'Pesquisar' && typeof n.props?.onChangeText === 'function',
  )[0];

const paginacao = (tree: ReturnType<typeof create>) =>
  tree.root.findAllByType(Pagination as React.ComponentType<{ pageCount?: number }>)[0];

describe('FAQ — busca e paginação reais', () => {
  it('mostra a primeira página com 6 perguntas e pageCount da lista inteira', async () => {
    const tree = await render();
    expect(titulos(tree)).toHaveLength(6);
    expect(paginacao(tree).props.pageCount).toBe(2);
  });

  it('a página 2 mostra as 6 perguntas restantes', async () => {
    const tree = await render();
    await act(async () => { paginacao(tree).props.onPageChange(2); });
    const t = titulos(tree);
    expect(t).toHaveLength(6);
    expect(t[0]).toBe('O que fazer se o aplicativo travar?');
  });

  it('a busca filtra por pergunta e resposta, sem exigir acento', async () => {
    const tree = await render();
    await act(async () => { busca(tree).props.onChangeText('notificacoes'); });
    expect(titulos(tree)).toEqual(['Como ativar notificações?']);
    expect(paginacao(tree).props.pageCount).toBe(1);
  });

  it('mudar a busca volta pra primeira página', async () => {
    const tree = await render();
    await act(async () => { paginacao(tree).props.onPageChange(2); });
    await act(async () => { busca(tree).props.onChangeText('senha'); });
    expect(titulos(tree)).toContain('Esqueci minha senha, o que fazer?');
    expect(paginacao(tree).props.currentPage).toBe(1);
  });

  it('busca sem resultado mostra lista vazia', async () => {
    const tree = await render();
    await act(async () => { busca(tree).props.onChangeText('zzzzz'); });
    expect(titulos(tree)).toHaveLength(0);
  });
});
