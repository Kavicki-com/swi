import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

// Telas com campo de texto tratam o teclado para manter o conteúdo editável
// visível, inclusive o compositor do chat.
//
// A cobertura era irregular: o fluxo de (auth) tinha tratamento, e settings,
// chat e os modais não. Este teste lê os FONTES, e não o comportamento,
// porque o que falhava não era a lógica, era a ausência do wrapper. Mesmo
// formato do web-bundler-compat do DS: travar um invariante que nenhum teste
// de render alcança.
//
// A biblioteca é react-native-keyboard-controller, compatível com a Nova
// Arquitetura do React Native.

const ROOT = join(__dirname, '..');

// Digita texto → o teclado sobe.
const ENTRADA_DE_TEXTO = /<TextInput|<Input\b|<SearchInput|<PasswordInput/;

// Qualquer um destes resolve; a escolha depende do layout (scroll longo,
// bottom-sheet ou compositor fixo).
const TRATA_TECLADO =
  /KeyboardAwareScrollView|KeyboardAvoidingView|KeyboardStickyView|useKeyboardHandler|useReanimatedKeyboardAnimation/;

// Campo ANCORADO NO TOPO: o teclado abre embaixo e nunca o cobre. Pôr wrapper
// aqui só adicionaria salto visual.
const DISPENSADOS = new Set([
  'app/(app)/chat/inbox.tsx', // busca fixa no topo da lista
  'app/(app)/reports/index.tsx', // idem
  'app/(app)/settings/faq.tsx', // idem
  'components/PasswordInput.tsx', // primitivo reusado; quem trata é a tela
]);

const walk = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return name === 'node_modules' ? [] : walk(full);
    return [full];
  });

const rel = (f: string) => f.slice(ROOT.length + 1).split('\\').join('/');

describe('cobertura de teclado', () => {
  it('toda tela com campo de texto trata o teclado', () => {
    const arquivos = [join(ROOT, 'app'), join(ROOT, 'components')]
      .flatMap(walk)
      .filter((f) => f.endsWith('.tsx') && !f.endsWith('.test.tsx'));

    const descobertos = arquivos.filter((f) => {
      const caminho = rel(f);
      if (DISPENSADOS.has(caminho)) return false;
      const src = readFileSync(f, 'utf8');
      return ENTRADA_DE_TEXTO.test(src) && !TRATA_TECLADO.test(src);
    });

    expect(descobertos.map(rel)).toEqual([]);
  });

  // A lista de dispensados é uma decisão, não um depósito: se a tela deixar de
  // ter campo de texto, a entrada sai junto, senão ela silenciosamente libera
  // uma tela futura que reaproveite o arquivo.
  it('todo dispensado ainda tem campo de texto, a lista não pode apodrecer', () => {
    const obsoletos = [...DISPENSADOS].filter((caminho) => {
      const src = readFileSync(join(ROOT, caminho), 'utf8');
      return !ENTRADA_DE_TEXTO.test(src);
    });
    expect(obsoletos).toEqual([]);
  });
});
