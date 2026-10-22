import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { StatCol } from '../../../components/dashboard/StatCol';

// Uma coluna da faixa de sinais do dashboard. O valor fica em UMA linha; o
// rótulo diz por que falta o valor e quebra em até três, centralizado, porque
// cortado ele mentiria ("Esta pulseira não envia pressão" não cabe em 80).
const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const theme = { gap: { sm: 6 }, content: { dark: '#111' } } as unknown as Parameters<
  typeof StatCol
>[0]['theme'];

const render = async (label: string, value: string) => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <StatCol iconNode={<View />} label={label} value={value} width={80} theme={theme} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const clampedCount = (tree: ReactTestRenderer, text: string, lines = 1) =>
  tree.root.findAll((n) => n.props?.children === text && n.props?.numberOfLines === lines).length;

describe('StatCol', () => {
  it('trava o valor em uma linha', async () => {
    const tree = await render('BPM', '--');
    expect(clampedCount(tree, '--')).toBeGreaterThan(0);
  });

  it('deixa o rótulo quebrar em até três linhas, centralizado', async () => {
    const rotulo = 'Esta pulseira não envia pressão';
    const tree = await render(rotulo, '--');
    expect(clampedCount(tree, rotulo, 3)).toBeGreaterThan(0);
    const texto = tree.root.findAll((n) => n.props?.children === rotulo && n.props?.numberOfLines === 3);
    expect(texto.some((n) => n.props.style?.textAlign === 'center')).toBe(true);
  });
});
