// Stub deploy-gated da Fatia 7: cada método do api amplify lança até as impls reais
// (generateClient<Schema>) existirem. NUNCA é invocado em modo mock (default).
export function notDeployedApi<T extends object>(): T {
  return new Proxy({} as T, {
    get(_target, prop) {
      return () => {
        throw new Error(
          `amplify backend não deployado (chamou .${String(prop)}) — pendência de deploy da Fatia 7`,
        )
      }
    },
  })
}
