import { createGlobalStyle } from 'styled-components'
import { useTheme } from '@kavicki/swi-design-system'

/**
 * Sem esta regra, campos como "Cidade" e "Senha atual" em Dados do cadastro
 * aparecem com fundo amarelo, fugindo do tema escuro. É o autofill do Chrome:
 * ao preencher um campo, o user-agent pinta o fundo de amarelo.
 *
 * Por que a regra mora AQUI e não no DS, apesar do Input ser componente do DS:
 * o DS é React Native first e todo styled-components dele vem de
 * `styled-components/native`, que NÃO processa pseudo-seletor. Verificado no
 * Storybook hospedado: a regra `&::-webkit-scrollbar-thumb:hover` do
 * ChatSection sai no CSS como texto aninhado cru
 * (`.r-12l83sf { &::-webkit-scrollbar-thumb:hover { ... } }`) e só resolve por
 * acidente, porque o Chrome moderno entende CSS aninhado. Apoiar o autofill
 * nisso seria frágil: derrubar o amarelo exige `-webkit-box-shadow inset`
 * justamente para vencer a especificidade do user-agent.
 *
 * É a mesma categoria dos escapes que já existem no <style> do index.html (o
 * inset shadow do DonutChart, o teto do painel do Combobox): comportamento de
 * navegador que o DS, sendo RN, não tem como expressar.
 *
 * POR QUE OS TOKENS VÊM POR PROP e não de `({ theme })`: o Vite carrega
 * `styled-components` e `styled-components/native` como instâncias separadas,
 * então elas NÃO compartilham o ThemeContext. Ler `theme` aqui devolve
 * undefined e derruba o app inteiro na montagem (tela branca, verificado).
 * O `useTheme()` do DS é a fonte correta e continua sendo respeitada.
 *
 * As cores espelham a lógica do próprio Input do DS (Input.styles.ts,
 * `rowBackground`): surface.standard em repouso, surface.medium em hover/foco.
 * O texto usa content.dark, o mesmo do StyledInput.
 *
 * O `transition` longuíssimo no background é o truque conhecido para o caso em
 * que o Chrome ignora o box-shadow: adia a pintura do amarelo para um futuro
 * que não chega.
 */
const AutofillStyle = createGlobalStyle<{
  $fundo: string
  $fundoAtivo: string
  $texto: string
}>`
  input:-webkit-autofill,
  input:-webkit-autofill:active {
    -webkit-box-shadow: 0 0 0 1000px ${(p) => p.$fundo} inset;
    -webkit-text-fill-color: ${(p) => p.$texto};
    caret-color: ${(p) => p.$texto};
    transition: background-color 600000s 0s;
  }

  input:-webkit-autofill:hover,
  input:-webkit-autofill:focus {
    -webkit-box-shadow: 0 0 0 1000px ${(p) => p.$fundoAtivo} inset;
  }
`

export function GlobalStyles() {
  const theme = useTheme()
  return (
    <AutofillStyle
      $fundo={theme.surface.standard}
      $fundoAtivo={theme.surface.medium}
      $texto={theme.content.dark}
    />
  )
}
