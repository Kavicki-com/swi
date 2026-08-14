import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SwiThemeProvider } from '@kavicki/swi-design-system';
import Step1 from '../../../../app/(auth)/complimentary-data/step-1';
import { useProfile } from '../../../../services/profile/ProfileProvider';
import { useAuth } from '../../../../services/auth/AuthProvider';

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));
jest.mock('../../../../lib/media/useMediaPicker', () => ({
  useMediaPicker: () => ({ takePhoto: jest.fn(), pickFromGallery: jest.fn(), picking: false }),
}));
jest.mock('../../../../services/api/uploadMedia', () => ({ uploadImage: jest.fn() }));
jest.mock('../../../../services/profile/ProfileProvider', () => ({ useProfile: jest.fn() }));
jest.mock('../../../../services/auth/AuthProvider', () => ({ useAuth: jest.fn() }));

const mockUseProfile = useProfile as jest.Mock;
const mockUseAuth = useAuth as jest.Mock;

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
          <Step1 />
        </SwiThemeProvider>
      </SafeAreaProvider>,
    );
  });
  return tree;
};

const field = (tree: ReturnType<typeof create>, label: string) =>
  tree.root.findAll(
    (n) => n.props?.label === label && typeof n.props?.onChangeText === 'function',
  )[0];

beforeEach(() => {
  mockUseProfile.mockReturnValue({ profile: null, saveProfile: jest.fn() });
  mockUseAuth.mockReturnValue({
    user: { id: 'u1', email: 'gabriel@empresa.com', name: 'Gabriel Fernandes Silva' },
  });
});

// O wizard roda DEPOIS do primeiro login pós-aprovação. O nome tem UMA fonte,
// a conta criada no cadastro, então o campo vem completo como a pessoa digitou
// lá, sem segunda digitação nem truncamento.
describe('step-1: pré-preenchimento do nome', () => {
  it('usa o nome completo da conta logada, não o primeiro nome', async () => {
    const tree = await render();
    expect(field(tree, 'Nome completo').props.value).toBe('Gabriel Fernandes Silva');
  });

  // Retomada de wizard abandonado: o passo 1 já foi salvo antes, o perfil
  // manda (pode ter sido corrigido em relação ao nome da conta).
  it('perfil já salvo tem prioridade sobre o nome da conta', async () => {
    mockUseProfile.mockReturnValue({
      profile: { fullName: 'Gabriel F. Silva Corrigido' },
      saveProfile: jest.fn(),
    });
    const tree = await render();
    expect(field(tree, 'Nome completo').props.value).toBe('Gabriel F. Silva Corrigido');
  });

  it('saudação usa só o primeiro nome, como no Figma', async () => {
    const tree = await render();
    // `{username}!` vira children em array, achata pra comparar o texto visível.
    const textos = tree.root
      .findAll((n) => Array.isArray(n.props?.children) || typeof n.props?.children === 'string')
      .map((n) => [n.props.children].flat().filter((c) => typeof c === 'string').join(''));
    expect(textos).toContain('Gabriel!');
    expect(textos).not.toContain('Gabriel Fernandes Silva!');
  });
});
