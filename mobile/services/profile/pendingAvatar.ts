import * as SecureStore from 'expo-secure-store';
import { File, Paths } from 'expo-file-system';

// Foto escolhida no passo 1 do cadastro, esperando o primeiro login.
//
// POR QUE ESPERAR: o wizard roda ANTES da conta existir — a conta só nasce no
// fim do passo 3. O `/media/presign` exige token, e liberar presign sem
// autenticação abriria o bucket pra qualquer um escrever. Então a foto fica
// guardada e sobe no flush do primeiro login, junto com o resto do perfil.
//
// POR QUE COPIAR OS BYTES, e não guardar a URI: o endereço que o seletor
// devolve (`ph://` no iOS, `content://` no Android) é um handle temporário.
// A aprovação do admin pode levar dias; até lá aquele endereço provavelmente
// não resolve mais, e o upload falharia EM SILÊNCIO — pior que não ter
// oferecido o campo. A cópia vive no armazenamento do app e sobrevive a
// reinícios.
//
// Limite conhecido: reinstalar o app apaga a cópia. Por isso `read` confere se
// o arquivo ainda existe antes de devolver o caminho.
const AVATAR_KEY = 'swi.profile.pendingAvatar';

/**
 * Copia a foto escolhida pro armazenamento do app e guarda o caminho.
 *
 * Nunca propaga erro: a foto é opcional, e derrubar o cadastro inteiro porque
 * uma cópia falhou seria desproporcional.
 */
export async function stashPendingAvatar(uri: string): Promise<void> {
  try {
    // A extensão precisa sobreviver: `contentTypeFor` deriva o content-type do
    // upload a partir dela, e sem ela tudo viraria jpeg.
    const ext = /\.png(\?|$)/i.test(uri) ? 'png' : 'jpg';
    const destino = new File(Paths.document, `pending-avatar.${ext}`);
    // Uma foto pendente por vez — se a pessoa trocar de ideia no wizard, a
    // anterior não pode ficar ocupando espaço nem ser enviada por engano.
    if (destino.exists) destino.delete();
    new File(uri).copy(destino);
    await SecureStore.setItemAsync(AVATAR_KEY, destino.uri);
  } catch {
    // Silencioso de propósito — ver acima.
  }
}

/** Caminho da foto pendente, ou `null` se não há nenhuma utilizável. */
export async function readPendingAvatar(): Promise<string | null> {
  const caminho = await SecureStore.getItemAsync(AVATAR_KEY);
  if (!caminho) return null;
  // O SecureStore pode sobreviver a uma reinstalação que apagou o arquivo.
  // Devolver um caminho morto faria o flush estourar no primeiro login —
  // justamente quando a pessoa acabou de ser aprovada.
  try {
    return new File(caminho).exists ? caminho : null;
  } catch {
    return null;
  }
}

/** Apaga a cópia do disco e a referência. Chamado depois do upload. */
export async function clearPendingAvatar(): Promise<void> {
  const caminho = await SecureStore.getItemAsync(AVATAR_KEY);
  if (caminho) {
    try {
      const f = new File(caminho);
      if (f.exists) f.delete();
    } catch {
      // Arquivo já sumiu — a referência sai do mesmo jeito.
    }
  }
  await SecureStore.deleteItemAsync(AVATAR_KEY);
}
