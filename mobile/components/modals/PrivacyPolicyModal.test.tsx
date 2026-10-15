import { act, create, type ReactTestRenderer } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import { PrivacyPolicyModal } from './PrivacyPolicyModal';

// A política que o trabalhador lê é a real da plataforma, versionada no próprio
// texto. Nada do texto de exemplo da empresa fictícia pode sobrar.

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const render = async () => {
  let tree!: ReactTestRenderer;
  await act(async () => {
    tree = create(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SwiThemeProvider>
          <PrivacyPolicyModal onClose={jest.fn()} />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

// Só o que a pessoa lê: os filhos de texto, sem rótulo de acessibilidade.
const textoLido = (tree: ReactTestRenderer): string => {
  const pedacos: string[] = [];
  tree.root.findAll(() => true).forEach((n) => {
    const c = n.props?.children;
    if (typeof c === 'string') pedacos.push(c);
  });
  return Array.from(new Set(pedacos)).join('\n');
};

describe('PrivacyPolicyModal: texto da política', () => {
  it('não traz mais o texto de exemplo da empresa fictícia', async () => {
    expect(textoLido(await render())).not.toContain('Excelsior');
  });

  it('mostra a versão e a data da política', async () => {
    expect(textoLido(await render())).toContain('Versão 1.0, 15 de outubro de 2026');
  });
});
