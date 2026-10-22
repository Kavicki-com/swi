import { act, create } from 'react-test-renderer';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import {
  Accordion,
  Pagination,
  SwiThemeProvider,
} from '@kavicki/swi-design-system';
import SettingsFAQ from '../../../../app/(app)/settings/faq';

// As respostas do FAQ citam botões e telas do app pelo nome. Cada nome citado
// tem que existir: "Primeiro acesso" e "Recuperar senha" no login, "Editar
// perfil", "Permissões" e "Suporte" nas Configurações.

jest.mock('expo-router', () => ({
  useRouter: () => ({ back: jest.fn(), push: jest.fn() }),
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

type Par = { q: string; a: string };

// Todas as perguntas e respostas, das duas páginas.
const todas = async (): Promise<Par[]> => {
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
  const lidos = () =>
    tree.root
      .findAllByType(Accordion as React.ComponentType<{ title: string; children: string }>)
      .map((n) => ({ q: n.props.title, a: n.props.children }));
  const pares = lidos();
  const paginas = tree.root.findAllByType(
    Pagination as React.ComponentType<{ pageCount: number; onPageChange: (p: number) => void }>,
  )[0];
  for (let p = 2; p <= paginas.props.pageCount; p += 1) {
    await act(async () => { paginas.props.onPageChange(p); });
    pares.push(...lidos());
  }
  return pares;
};

const resposta = (pares: Par[], q: string) => pares.find((p) => p.q === q)?.a;

describe('FAQ: nomes de tela e botão que existem no app', () => {
  it('nenhuma resposta cita tela ou botão que não existe', async () => {
    const texto = (await todas()).map((p) => p.a).join('\n');

    expect(texto).not.toContain('Criar conta');
    expect(texto).not.toContain('"Esqueci minha senha"');
    expect(texto).not.toContain('siga o link');
    expect(texto).not.toContain('Fale conosco');
    expect(texto).not.toContain('Dados pessoais');
    expect(texto).not.toContain('Configurações > Preferências');
    expect(texto).not.toContain('reconfirmação por e-mail');
  });

  it('criar conta aponta para "Primeiro acesso"', async () => {
    expect(resposta(await todas(), 'Como faço para criar uma conta?')).toBe(
      'Na tela de login, toque em "Primeiro acesso" e preencha seus dados pessoais. Após confirmar seu e-mail, complete os dados complementares e pareie sua smartband para concluir o cadastro.',
    );
  });

  it('senha esquecida aponta para "Recuperar senha" e para o código', async () => {
    expect(resposta(await todas(), 'Esqueci minha senha, o que fazer?')).toBe(
      'Na tela de login, toque em "Recuperar senha", informe seu e-mail cadastrado e use o código enviado para definir uma nova senha.',
    );
  });

  it('perfil aponta para Configurações > Editar perfil, sem reconfirmação', async () => {
    expect(resposta(await todas(), 'Como atualizar meu perfil?')).toBe(
      'Acesse Configurações > Editar perfil para editar seu nome, telefone e demais informações.',
    );
  });

  it('notificações apontam para Configurações > Permissões', async () => {
    expect(resposta(await todas(), 'Como ativar notificações?')).toBe(
      'Acesse Configurações > Permissões e mantenha as notificações habilitadas. Confirme também a permissão de notificações nas configurações do sistema do seu celular.',
    );
  });

  it('as duas menções de contato apontam para "Suporte"', async () => {
    const pares = await todas();

    expect(resposta(pares, 'O que fazer se o aplicativo travar?')).toBe(
      'Force o fechamento, abra novamente e verifique sua conexão. Se o problema persistir, envie um relato pela tela "Suporte" em Configurações.',
    );
    expect(resposta(pares, 'Como envio feedback ou reporto um problema?')).toBe(
      'Em Configurações > Suporte, escolha o tipo de mensagem (sugestão, dúvida, problema técnico) e descreva o ocorrido. Nosso time responde por e-mail.',
    );
  });

  it('as perguntas seguem as mesmas 12', async () => {
    expect(await todas()).toHaveLength(12);
  });
});
