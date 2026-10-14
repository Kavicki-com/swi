import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { View } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { StatCol } from '../../../components/dashboard/StatCol';

// Uma coluna da faixa de sinais do dashboard. O valor e o rótulo têm que ficar
// em UMA linha: um rótulo que quebra ("Sem medição" no estado sem leitura)
// cresceria a coluna e deslocaria a fileira de ações do rodapé.
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

const clampedCount = (tree: ReactTestRenderer, text: string) =>
  tree.root.findAll((n) => n.props?.children === text && n.props?.numberOfLines === 1).length;

describe('StatCol', () => {
  it('trava o valor em uma linha', async () => {
    const tree = await render('BPM', '--');
    expect(clampedCount(tree, '--')).toBeGreaterThan(0);
  });

  it('trava o rótulo em uma linha, para não deslocar o rodapé', async () => {
    const tree = await render('Sem medição', '--');
    expect(clampedCount(tree, 'Sem medição')).toBeGreaterThan(0);
  });
});
