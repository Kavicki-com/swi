import { act, create } from 'react-test-renderer';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import * as SplashScreen from 'expo-splash-screen';
import { WebPanelNotice } from '../../components/WebPanelNotice';

jest.mock('expo-splash-screen', () => ({
  preventAutoHideAsync: jest.fn(),
  hideAsync: jest.fn(async () => {}),
}));

const render = async () => {
  let tree!: ReturnType<typeof create>;
  await act(async () => {
    tree = create(
      <SwiThemeProvider>
        <WebPanelNotice />
      </SwiThemeProvider>,
    );
  });
  return tree;
};

// Junta todo texto renderizado: as strings vivem dentro de Title e Text do DS,
// e afirmar sobre a árvore inteira evita depender da estrutura interna deles.
const textoDe = (tree: ReturnType<typeof create>) =>
  tree.root
    .findAll((n) => typeof n.children?.[0] === 'string')
    .map((n) => n.children[0] as string)
    .join(' ');

describe('WebPanelNotice', () => {
  it('diz para onde ir, em vez de só recusar o acesso', async () => {
    const tree = await render();
    const texto = textoDe(tree);
    expect(texto).toContain('painel');
    expect(texto).toMatch(/Android/);
  });

  // O _layout chama preventAutoHideAsync no topo do módulo, e neste ramo
  // nenhum outro caminho chega ao hideAsync. Sem esta chamada o usuário fica
  // olhando a splash para sempre, sem nunca ver o aviso.
  it('esconde a splash, que ninguém mais vai esconder neste ramo', async () => {
    await render();
    expect(SplashScreen.hideAsync).toHaveBeenCalled();
  });
});
