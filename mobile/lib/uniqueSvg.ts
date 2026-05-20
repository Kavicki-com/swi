// Inline SVGs rendered via <SvgXml> share their `<defs>` ids globally in the
// DOM. When the same SVG renders on 2 screens mounted at once (expo-router
// Stack keeps previous screens alive), the duplicate `id` makes `url(#...)`
// references resolve to whichever copy comes first — usually the hidden
// background screen — breaking the visual on the active screen.
//
// `useUniqueSvg` rewrites every `id="x"` and `url(#x)` in the XML to
// `id="x_<reactId>"` / `url(#x_<reactId>)` so each instance owns its own
// namespace. Uses React's `useId()` so the namespace is stable across renders
// of the same component instance but unique across instances.

import { useId, useMemo } from 'react';

export function useUniqueSvg(xml: string): string {
  const reactId = useId();
  return useMemo(() => {
    const ns = reactId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return xml
      .replace(/id="([^"]+)"/g, (_, n) => `id="${n}_${ns}"`)
      .replace(/url\(#([^)]+)\)/g, (_, n) => `url(#${n}_${ns})`);
  }, [xml, reactId]);
}

// Native react-native-svg components (<Defs>/<LinearGradient>/etc) declared
// inline em JSX também colidem com instâncias paralelas da mesma tela (Stack
// do expo-router monta a screen 2x). `useUniqueId(base)` retorna um id
// estável por instância — usar em qualquer `<LinearGradient id={...} />` +
// `fill={\`url(#${id})\`}` declarado dentro de um componente funcional.
export function useUniqueId(base: string): string {
  const reactId = useId();
  return `${base}-${reactId.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
}
