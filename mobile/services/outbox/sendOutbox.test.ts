import { createSendOutbox, MAX_QUEUED_SENDS, type SendItem } from './sendOutbox';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

// Dublê do arquivo: um texto em memória com os dois verbos do real, como na
// suíte do positionOutbox. Reinício do app = outra fábrica sobre o mesmo dublê.
function memoryStorage(initial: string | null = null) {
  let text = initial;
  const read = jest.fn(async () => text);
  const write = jest.fn(async (next: string) => {
    text = next;
  });
  const storage: OutboxStorage = { read, write };
  return { storage, read, write, current: () => text };
}

const BASE = Date.parse('2026-10-04T12:00:00.000Z');
const hora = (segundos: number) => new Date(BASE + segundos * 1000).toISOString();

function mensagem(id: string, over: Partial<SendItem> = {}): SendItem {
  return {
    id,
    kind: 'chat.message',
    createdAt: hora(0),
    conversationId: 'a#b',
    body: `texto ${id}`,
    images: [],
    ...over,
  } as SendItem;
}

function relatorio(id: string, fotos: string[] = []): SendItem {
  return {
    id,
    kind: 'report',
    createdAt: hora(0),
    title: `Relatório ${id}`,
    summary: 'Resumo',
    details: 'Detalhes',
    responsibles: ['Ana'],
    images: fotos.map((localUri) => ({ localUri, key: null })),
  };
}

function comentario(id: string): SendItem {
  return { id, kind: 'report.comment', createdAt: hora(0), reportId: 'r1', body: 'oi', images: [] };
}

describe('createSendOutbox', () => {
  it('fila vazia sem arquivo', async () => {
    const { storage } = memoryStorage();
    expect(await createSendOutbox(storage).pending('u1')).toEqual([]);
  });

  it('guarda os três tipos de envio na ordem de entrada', async () => {
    const { storage } = memoryStorage();
    const outbox = createSendOutbox(storage);

    expect(await outbox.append('u1', mensagem('m1'))).toBe(true);
    expect(await outbox.append('u1', relatorio('r1'))).toBe(true);
    expect(await outbox.append('u1', comentario('c1'))).toBe(true);

    expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m1', 'r1', 'c1']);
  });

  it('a fila sobrevive ao reinício do app', async () => {
    const { storage } = memoryStorage();
    await createSendOutbox(storage).append('u1', relatorio('r1', ['file:///a.jpg']));

    const depois = await createSendOutbox(storage).pending('u1');

    expect(depois).toEqual([relatorio('r1', ['file:///a.jpg'])]);
  });

  it('duas entradas ao mesmo tempo ficam as duas', async () => {
    const { storage } = memoryStorage();
    const outbox = createSendOutbox(storage);

    await Promise.all([outbox.append('u1', mensagem('m1')), outbox.append('u1', mensagem('m2'))]);

    expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m1', 'm2']);
  });

  // Ao contrário das posições, aqui o mais velho não sai para o novo entrar:
  // é um relatório que a pessoa escreveu. No teto, o novo envio é recusado.
  it('no teto recusa o novo envio e não mexe no arquivo', async () => {
    const cheia = {
      owner: 'u1',
      items: Array.from({ length: MAX_QUEUED_SENDS }, (_, i) => mensagem(`m${i}`)),
    };
    const { storage, write } = memoryStorage(JSON.stringify(cheia));
    const outbox = createSendOutbox(storage);

    expect(await outbox.append('u1', mensagem('a-mais'))).toBe(false);

    expect(write).not.toHaveBeenCalled();
    expect(await outbox.pending('u1')).toHaveLength(MAX_QUEUED_SENDS);
  });

  describe('dono', () => {
    // Ler não apaga. Um envio antigo ainda em andamento, de quem já saiu, lê a
    // fila mais uma vez depois que outra pessoa entrou: se a leitura apagasse,
    // levaria os itens de quem está logado agora.
    it('itens de outra pessoa não aparecem, e ler não mexe no arquivo', async () => {
      const { storage, write } = memoryStorage();
      await createSendOutbox(storage).append('u1', mensagem('m1'));
      write.mockClear();

      expect(await createSendOutbox(storage).pending('u2')).toEqual([]);

      expect(write).not.toHaveBeenCalled();
      expect((await createSendOutbox(storage).pending('u1')).map((i) => i.id)).toEqual(['m1']);
    });

    // O descarte é do login: quem entra toma a fila e recebe o que saiu, para
    // apagar as cópias das fotos.
    it('claim de outra pessoa esvazia a fila e devolve o que saiu', async () => {
      const { storage, current } = memoryStorage();
      await createSendOutbox(storage).append('u1', relatorio('r1', ['file:///a.jpg']));

      const descartados = await createSendOutbox(storage).claim('u2');

      expect(descartados).toEqual([relatorio('r1', ['file:///a.jpg'])]);
      expect(JSON.parse(current() ?? '')).toEqual({ owner: 'u2', items: [] });
    });

    it('claim do mesmo dono não descarta nem escreve', async () => {
      const { storage, write } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', mensagem('m1'));
      write.mockClear();

      expect(await outbox.claim('u1')).toEqual([]);

      expect(write).not.toHaveBeenCalled();
      expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m1']);
    });

    it('o envio de quem entrou agora não herda os itens do anterior', async () => {
      const { storage } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', mensagem('m1'));

      await outbox.append('u2', mensagem('m2'));

      expect((await outbox.pending('u2')).map((i) => i.id)).toEqual(['m2']);
    });

    // O logout não limpa a fila: a mesma pessoa entra de novo e o envio segue.
    it('o mesmo dono reencontra os seus itens', async () => {
      const { storage } = memoryStorage();
      await createSendOutbox(storage).append('u1', mensagem('m1'));

      expect((await createSendOutbox(storage).pending('u1')).map((i) => i.id)).toEqual(['m1']);
    });
  });

  describe('remove', () => {
    it('tira só o item pedido', async () => {
      const { storage } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', mensagem('m1'));
      await outbox.append('u1', mensagem('m2'));

      await outbox.remove('u1', 'm1');

      expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m2']);
    });

    it('id desconhecido ou outro dono não mexe no arquivo', async () => {
      const { storage, write } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', mensagem('m1'));
      write.mockClear();

      await outbox.remove('u1', 'nao-existe');
      await outbox.remove('u2', 'm1');

      expect(write).not.toHaveBeenCalled();
    });
  });

  // A foto sobe uma vez só: a key fica no item antes do POST, e o reenvio
  // depois de um reinício leva o mesmo corpo sem subir de novo.
  describe('setImageKey', () => {
    it('grava a key na foto certa e ela sobrevive ao reinício', async () => {
      const { storage } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', relatorio('r1', ['file:///a.jpg', 'file:///b.jpg']));

      expect(await outbox.setImageKey('u1', 'r1', 1, 'reports/b.jpg')).toBe(true);

      const [item] = await createSendOutbox(storage).pending('u1');
      expect(item.images).toEqual([
        { localUri: 'file:///a.jpg', key: null },
        { localUri: 'file:///b.jpg', key: 'reports/b.jpg' },
      ]);
    });

    it('item ou posição desconhecidos não mexem no arquivo', async () => {
      const { storage, write } = memoryStorage();
      const outbox = createSendOutbox(storage);
      await outbox.append('u1', relatorio('r1', ['file:///a.jpg']));
      write.mockClear();

      // Quem chamou precisa saber: sem a key gravada, o POST não pode sair.
      expect(await outbox.setImageKey('u1', 'nao-existe', 0, 'reports/x.jpg')).toBe(false);
      expect(await outbox.setImageKey('u1', 'r1', 5, 'reports/x.jpg')).toBe(false);
      expect(await outbox.setImageKey('u2', 'r1', 0, 'reports/x.jpg')).toBe(false);

      expect(write).not.toHaveBeenCalled();
    });
  });

  describe('arquivo estragado', () => {
    it.each([
      ['texto que não é JSON', '{{{'],
      ['JSON de outra forma', JSON.stringify([1, 2, 3])],
      ['sem a lista de itens', JSON.stringify({ owner: 'u1' })],
    ])('%s vira fila vazia, e a próxima entrada conserta', async (_nome, texto) => {
      const { storage } = memoryStorage(texto);
      const outbox = createSendOutbox(storage);

      expect(await outbox.pending('u1')).toEqual([]);
      await outbox.append('u1', mensagem('m1'));

      expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m1']);
    });

    // Um item que a fila não sabe enviar travaria tudo atrás dele.
    it('item de forma desconhecida é ignorado, os outros seguem', async () => {
      const texto = JSON.stringify({
        owner: 'u1',
        items: [
          mensagem('m1'),
          { id: 'x1', kind: 'journey.action', createdAt: hora(0), images: [] },
          { kind: 'chat.message' },
          'lixo',
          comentario('c1'),
        ],
      });
      const { storage } = memoryStorage(texto);

      const itens = await createSendOutbox(storage).pending('u1');

      expect(itens.map((i) => i.id)).toEqual(['m1', 'c1']);
    });

    it('falha de leitura vale como fila vazia', async () => {
      const { storage, read } = memoryStorage();
      read.mockRejectedValueOnce(new Error('disco'));

      expect(await createSendOutbox(storage).pending('u1')).toEqual([]);
    });
  });

  it('uma operação que falha não trava as seguintes', async () => {
    const { storage, write } = memoryStorage();
    const outbox = createSendOutbox(storage);
    write.mockRejectedValueOnce(new Error('disco cheio'));

    await expect(outbox.append('u1', mensagem('m1'))).rejects.toThrow('disco cheio');
    await expect(outbox.append('u1', mensagem('m2'))).resolves.toBe(true);

    expect((await outbox.pending('u1')).map((i) => i.id)).toEqual(['m2']);
  });
});
