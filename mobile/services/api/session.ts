// Id do worker logado, em memória, pra APIs que precisam do `myId` de forma
// SÍNCRONA (o token vive no SecureStore, que é async). Populado no login.
let userId = '';
export function setUserId(id: string): void { userId = id ?? ''; }
export function getUserId(): string { return userId; }
export function clearUserId(): void { userId = ''; }
