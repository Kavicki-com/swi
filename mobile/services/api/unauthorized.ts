// Aviso de que o servidor recusou o token numa chamada autenticada. Quem ouve
// é a sessão (AuthProvider), que confirma com o servidor antes de sair: 401
// também é resposta legítima de rota, como a senha atual errada na troca de
// senha.

const listeners = new Set<() => void>();

export function onUnauthorized(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function notifyUnauthorized(): void {
  for (const listener of [...listeners]) listener();
}
