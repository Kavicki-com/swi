import { createSendQueue, type SendQueueEvent } from './sendQueue';
import { createSendOutbox, MAX_QUEUED_SENDS, type SendItem } from './sendOutbox';
import type { SendFiles } from './sendFiles';
import type { SendTransport } from './sendDrain';
import type { OutboxStorage } from '../telemetry/telemetryOutbox';

function memoryStorage() {
  let text: string | null = null;
  const storage: OutboxStorage = {
    read: async () => text,
    write: async (next) => {
      text = next;
    },
  };
  return storage;
}

const AGORA = Date.parse('2026-10-04T12:00:00.000Z');
const comStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, apiError: true });
const semRede = () => new TypeError('Network request failed');

// O aparelho inteiro de mentira: o mesmo "disco" serve a várias montagens da
// fila, que é o que acontece quando o app fecha e abre.
function aparelho() {
  const storage = memoryStorage();
  const stage = jest.fn(async (uri: string) => `copia:${uri}`);
  const discard = jest.fn(async (_uris: readonly string[]) => undefined);
  const sweep = jest.fn(async (_keep: readonly string[]) => undefined);
  const locate = jest.fn((uri: string) => uri);
  const files: SendFiles = { stage, locate, discard, sweep };
  const upload = jest.fn(async (_item: SendItem, localUri: string) => `key:${localUri}`);
  const send = jest.fn(async (item: SendItem): Promise<unknown> => ({ servidor: item.id }));
  const transport: SendTransport = { upload, send };
  let n = 0;
  const abrir = () =>
    createSendQueue({
      outbox: createSendOutbox(storage),
      files,
      transport,
      now: () => AGORA,
      newId: () => `id-${(n += 1)}`,
    });
  return { storage, stage, locate, discard, sweep, upload, send, abrir };
}

const mensagem = (body = 'oi') =>
  ({ kind: 'chat.message', conversationId: 'a#b', body }) as const;

describe('createSendQueue', () => {
  describe('enqueue', () => {
    it('o item aparece no estado na hora, com chave e hora próprias, antes de o servidor responder', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');
      const mudou = jest.fn();
      queue.subscribe(mudou);

      await expect(queue.enqueue(mensagem('bom dia'))).resolves.toBe('queued');

      expect(queue.getState().items).toEqual([
        {
          id: 'id-1',
          kind: 'chat.message',
          createdAt: '2026-10-04T12:00:00.000Z',
          conversationId: 'a#b',
          body: 'bom dia',
          images: [],
        },
      ]);
      expect(mudou).toHaveBeenCalled();
    });

    // A hora do toque é o `createdAt` do item: o mesmo texto vai ao servidor
    // em toda tentativa.
    it('ações da jornada entram com a hora do toque, sem foto', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({ kind: 'journey.task.start', taskId: 't1', taskTitle: 'Inspeção' });
      await queue.enqueue({ kind: 'journey.pause' });

      expect(queue.getState().items).toEqual([
        {
          id: 'id-1',
          kind: 'journey.task.start',
          createdAt: '2026-10-04T12:00:00.000Z',
          taskId: 't1',
          taskTitle: 'Inspeção',
          images: [],
        },
        { id: 'id-2', kind: 'journey.pause', createdAt: '2026-10-04T12:00:00.000Z', images: [] },
      ]);
    });

    it('a foto da tarefa é copiada antes de entrar na fila', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({
        kind: 'journey.task.photo',
        taskId: 't1',
        taskTitle: 'Inspeção',
        imageUri: 'file:///f.jpg',
      });

      expect(a.stage).toHaveBeenCalledWith('file:///f.jpg');
      expect(queue.getState().items[0]).toMatchObject({
        kind: 'journey.task.photo',
        taskId: 't1',
        images: [{ localUri: 'copia:file:///f.jpg', key: null }],
      });
    });

    it('cada envio tem a própria chave', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue(mensagem('um'));
      await queue.enqueue(mensagem('dois'));

      expect(queue.getState().items.map((i) => i.id)).toEqual(['id-1', 'id-2']);
    });

    it('enviar dispara a tentativa na hora, sem esperar o relógio', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue(mensagem());
      await queue.kick();

      expect(a.send).toHaveBeenCalledTimes(1);
      expect(queue.getState().items).toEqual([]);
    });

    it('as fotos são copiadas para o armazenamento do app antes de entrar na fila', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({
        kind: 'report',
        title: 'T',
        summary: 'S',
        details: 'D',
        responsibles: ['Ana'],
        imageUris: ['file:///a.jpg', 'file:///b.jpg'],
      });
      await queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });

      const [relatorio, msg] = queue.getState().items;
      expect(relatorio.images).toEqual([
        { localUri: 'copia:file:///a.jpg', key: null },
        { localUri: 'copia:file:///b.jpg', key: null },
      ]);
      expect(msg.images).toEqual([{ localUri: 'copia:file:///c.jpg', key: null }]);
    });

    // Recusa na entrada: a tela ainda está aberta e a pessoa pode trocar a foto.
    it('foto recusada na entrada: nada entra na fila e as cópias já feitas saem', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');
      a.stage
        .mockResolvedValueOnce('copia:a')
        .mockRejectedValueOnce(new Error('A imagem passa de 15 MB. Escolha uma imagem menor.'));

      await expect(
        queue.enqueue({
          kind: 'report',
          title: 'T',
          summary: 'S',
          details: 'D',
          responsibles: [],
          imageUris: ['file:///a.jpg', 'file:///enorme.jpg'],
        }),
      ).rejects.toThrow(/15 MB/);

      expect(queue.getState().items).toEqual([]);
      expect(a.discard).toHaveBeenCalledWith(['copia:a']);
      expect(a.send).not.toHaveBeenCalled();
    });

    // No iOS o caminho da pasta do app muda numa atualização. A uri guardada
    // no item pode ser a de antes; quem sobe pergunta onde a cópia está agora.
    it('a foto sobe pelo caminho atual da cópia, não pela uri guardada', async () => {
      const a = aparelho();
      a.locate.mockImplementation((uri: string) => `agora:${uri}`);
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await queue.kick();

      expect(a.upload.mock.calls[0][1]).toBe('agora:copia:file:///c.jpg');
    });

    // A pessoa saiu enquanto a foto era copiada. Gravar o item agora poria um
    // envio dela na fila de quem entrou depois.
    it('sessão trocada durante a cópia da foto: o envio não entra e a cópia sai', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const queue = a.abrir();
      await queue.start('u1');
      let soltar!: () => void;
      a.stage.mockImplementationOnce(
        () => new Promise((resolve) => (soltar = () => resolve('copia:c'))),
      );

      const enviando = queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await new Promise((r) => setTimeout(r, 0));
      queue.stop();
      await queue.start('u2');
      await queue.enqueue(mensagem('de u2'));
      soltar();

      await expect(enviando).rejects.toThrow();
      expect(a.discard).toHaveBeenCalledWith(['copia:c']);
      expect(queue.getState().items.map((i) => i.kind === 'chat.message' && i.body)).toEqual([
        'de u2',
      ]);
    });

    it('fila cheia: devolve "full" e não copia foto nenhuma', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const queue = a.abrir();
      await queue.start('u1');
      for (let i = 0; i < MAX_QUEUED_SENDS; i += 1) await queue.enqueue(mensagem(`m${i}`));

      await expect(queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' })).resolves.toBe('full');

      expect(a.stage).not.toHaveBeenCalled();
      expect(queue.getState().items).toHaveLength(MAX_QUEUED_SENDS);
    });

    it('sem sessão aberta não aceita envio', async () => {
      const queue = aparelho().abrir();

      await expect(queue.enqueue(mensagem())).rejects.toThrow();
    });
  });

  describe('resultado do envio', () => {
    it('confirmado: sai do estado, avisa com a resposta do servidor e apaga as cópias', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');
      const eventos: SendQueueEvent[] = [];
      queue.onEvent((e) => eventos.push(e));

      await queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await queue.kick();

      expect(queue.getState().items).toEqual([]);
      expect(eventos).toHaveLength(1);
      expect(eventos[0]).toMatchObject({ type: 'sent', result: { servidor: 'id-1' } });
      expect(eventos[0].item.id).toBe('id-1');
      expect(a.discard).toHaveBeenCalledWith(['copia:file:///c.jpg']);
    });

    // Quem ouve o evento (o chat) troca o balão pendente pela mensagem do
    // servidor. Se o item ainda estivesse no estado, os dois apareceriam juntos.
    it('quando o evento de confirmação chega, o item já saiu do estado', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');
      let noEvento: number | null = null;
      queue.onEvent(() => {
        noEvento = queue.getState().items.length;
      });

      await queue.enqueue(mensagem());
      await queue.kick();

      expect(noEvento).toBe(0);
    });

    it('sem rede: o item fica no estado e a próxima tentativa envia', async () => {
      const a = aparelho();
      a.send.mockRejectedValueOnce(semRede());
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue(mensagem());
      await queue.kick();
      expect(queue.getState().items).toHaveLength(1);

      await queue.kick();
      expect(queue.getState().items).toEqual([]);
    });

    it('recusado: sai da fila, entra nos recusados e avisa com o motivo', async () => {
      const a = aparelho();
      a.send.mockRejectedValueOnce(comStatus(403));
      const queue = a.abrir();
      await queue.start('u1');
      const eventos: SendQueueEvent[] = [];
      queue.onEvent((e) => eventos.push(e));

      await queue.enqueue({ ...mensagem('texto'), imageUri: 'file:///c.jpg' });
      await queue.kick();

      const estado = queue.getState();
      expect(estado.items).toEqual([]);
      expect(estado.refused.map((r) => [r.item.id, r.reason])).toEqual([['id-1', 'rejected']]);
      expect(eventos).toEqual([expect.objectContaining({ type: 'refused', reason: 'rejected' })]);
      expect(a.discard).toHaveBeenCalledWith(['copia:file:///c.jpg']);
    });

    it('401: o envio para e nada mais sai até a pessoa entrar de novo', async () => {
      const a = aparelho();
      a.send.mockRejectedValueOnce(comStatus(401));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue(mensagem());
      await queue.kick();
      await queue.kick();
      await queue.kick();

      expect(a.send).toHaveBeenCalledTimes(1);
      expect(queue.getState().items).toHaveLength(1);

      await queue.start('u1');
      await queue.kick();

      expect(a.send).toHaveBeenCalledTimes(2);
      expect(queue.getState().items).toEqual([]);
    });

    // O servidor confirmou, mas o item não pôde sair do arquivo. Ele fica na
    // fila e a rodada seguinte repete o envio com a mesma chave, que o backend
    // reconhece: nada se perde e nada duplica.
    it('falha de disco na rodada não derruba quem chamou, e o item sai de novo com a mesma chave', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');
      const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
      const escrever = a.storage.write;
      a.send.mockImplementationOnce(async (item) => {
        a.storage.write = async () => {
          throw new Error('disco cheio');
        };
        return { servidor: item.id };
      });

      await queue.enqueue(mensagem());
      await expect(queue.kick()).resolves.toBeUndefined();

      expect(warn).toHaveBeenCalled();
      expect(queue.getState().items).toHaveLength(1);

      a.storage.write = escrever;
      await queue.kick();

      expect(a.send.mock.calls.map(([item]) => item.id)).toEqual(['id-1', 'id-1']);
      expect(queue.getState().items).toEqual([]);
      warn.mockRestore();
    });
  });

  describe('sessão', () => {
    it('ao abrir, retoma os envios que ficaram do mesmo dono e já tenta enviar', async () => {
      const a = aparelho();
      a.send.mockRejectedValueOnce(semRede());
      const antes = a.abrir();
      await antes.start('u1');
      await antes.enqueue(mensagem('ficou'));
      await antes.kick();

      const depois = a.abrir();
      await depois.start('u1');
      await depois.kick();

      expect(a.send).toHaveBeenCalledTimes(2);
      expect(a.send.mock.calls[1][0].id).toBe('id-1');
      expect(depois.getState().items).toEqual([]);
    });

    it('os itens pendentes aparecem no estado logo ao abrir', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const antes = a.abrir();
      await antes.start('u1');
      await antes.enqueue(mensagem('ficou'));
      await antes.kick();

      const depois = a.abrir();
      await depois.start('u1');

      expect(depois.getState().items.map((i) => i.id)).toEqual(['id-1']);
    });

    it('outra pessoa entra: os envios da anterior são descartados, com as fotos', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const antes = a.abrir();
      await antes.start('u1');
      await antes.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await antes.kick();
      antes.stop();
      a.send.mockClear();

      const depois = a.abrir();
      await depois.start('u2');
      await depois.kick();

      expect(depois.getState().items).toEqual([]);
      expect(a.discard).toHaveBeenCalledWith(['copia:file:///c.jpg']);
      expect(a.send).not.toHaveBeenCalled();
    });

    it('ao abrir, varre as cópias de foto que nenhum item usa', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const antes = a.abrir();
      await antes.start('u1');
      await antes.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await antes.kick();

      const depois = a.abrir();
      await depois.start('u1');

      expect(a.sweep).toHaveBeenLastCalledWith(['copia:file:///c.jpg']);
    });

    // A varredura do login apaga toda cópia de foto que nenhum item usa. Um
    // envio feito no mesmo instante copiaria a foto antes de o item existir na
    // fila, e a varredura a levaria. O envio espera a fila terminar de abrir.
    it('envio feito enquanto a fila abre espera a abertura: a varredura não leva a foto dele', async () => {
      const a = aparelho();
      a.send.mockReturnValue(new Promise(() => {}));
      const ordem: string[] = [];
      a.sweep.mockImplementation(async () => {
        ordem.push('varredura');
      });
      a.stage.mockImplementation(async (uri: string) => {
        ordem.push('cópia');
        return `copia:${uri}`;
      });
      const queue = a.abrir();

      const abrindo = queue.start('u1');
      const enviando = queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await Promise.all([abrindo, enviando]);

      expect(ordem).toEqual(['varredura', 'cópia']);
      expect(queue.getState().items).toHaveLength(1);
    });

    it('falha ao abrir a fila não impede o envio seguinte', async () => {
      const a = aparelho();
      const queue = a.abrir();
      const leitura = a.storage.read;
      a.storage.write = jest.fn(a.storage.write);
      (a.storage.write as jest.Mock).mockRejectedValueOnce(new Error('disco'));
      a.storage.read = async () => JSON.stringify({ owner: 'outra-pessoa', items: [] });

      await expect(queue.start('u1')).rejects.toThrow('disco');
      a.storage.read = leitura;

      await expect(queue.enqueue(mensagem())).resolves.toBe('queued');
    });

    // O upload de uma foto pode levar mais de um minuto com sinal fraco. O
    // token vai no pedido na hora do POST: sem esta trava, o relatório de quem
    // saiu seria criado em nome de quem entrou.
    it('upload em andamento, outra pessoa entra: o envio de quem saiu não é postado', async () => {
      const a = aparelho();
      let soltar!: () => void;
      a.upload.mockImplementationOnce(
        () => new Promise((resolve) => (soltar = () => resolve('key-1'))),
      );
      const queue = a.abrir();
      await queue.start('u1');
      const eventos: SendQueueEvent[] = [];
      queue.onEvent((e) => eventos.push(e));
      await queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await new Promise((r) => setTimeout(r, 0));

      queue.stop();
      await queue.start('u2');
      soltar();
      await new Promise((r) => setTimeout(r, 0));
      await queue.kick();

      expect(a.send).not.toHaveBeenCalled();
      expect(eventos).toEqual([]);
    });

    // A mesma pessoa sai e entra de novo durante o upload. Sem a trava, a
    // rodada antiga e a nova subiriam a foto cada uma e postariam a mesma
    // chave com corpos diferentes: o segundo viraria 422 e a tela diria
    // "recusado" para um envio que chegou.
    it('upload em andamento, a mesma pessoa entra de novo: um POST só, sem recusa', async () => {
      const a = aparelho();
      let soltar!: () => void;
      a.upload.mockImplementationOnce(
        () => new Promise((resolve) => (soltar = () => resolve('key-da-rodada-antiga'))),
      );
      const queue = a.abrir();
      await queue.start('u1');
      const eventos: SendQueueEvent[] = [];
      queue.onEvent((e) => eventos.push(e));
      await queue.enqueue({ ...mensagem(''), imageUri: 'file:///c.jpg' });
      await new Promise((r) => setTimeout(r, 0));

      queue.stop();
      await queue.start('u1');
      await queue.kick();
      soltar();
      await new Promise((r) => setTimeout(r, 0));

      expect(a.send).toHaveBeenCalledTimes(1);
      expect(a.send.mock.calls[0][0].images[0].key).toBe('key:copia:file:///c.jpg');
      expect(eventos.map((e) => e.type)).toEqual(['sent']);
    });

    it('ao sair, o estado esvazia e nada mais é enviado, mas a fila fica guardada', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const queue = a.abrir();
      await queue.start('u1');
      await queue.enqueue(mensagem());
      await queue.kick();
      a.send.mockClear();

      queue.stop();
      await queue.kick();

      expect(queue.getState()).toEqual({ items: [], refused: [], open: false, stalled: false });
      expect(a.send).not.toHaveBeenCalled();

      await queue.start('u1');
      expect(queue.getState().items).toHaveLength(1);
    });

    // A resposta de um envio antigo, de quem já saiu, não pode aparecer na
    // sessão de quem entrou depois.
    it('resposta que chega depois da saída não vira evento nem mexe no estado', async () => {
      const a = aparelho();
      let soltar!: () => void;
      a.send.mockImplementationOnce(() => new Promise((resolve) => (soltar = () => resolve({}))));
      const queue = a.abrir();
      await queue.start('u1');
      const eventos: SendQueueEvent[] = [];
      queue.onEvent((e) => eventos.push(e));
      await queue.enqueue(mensagem());
      await new Promise((r) => setTimeout(r, 0));

      queue.stop();
      await queue.start('u2');
      soltar();
      await new Promise((r) => setTimeout(r, 0));

      expect(eventos).toEqual([]);
      expect(queue.getState()).toEqual({ items: [], refused: [], open: true, stalled: false });
    });
  });

  // A tela da jornada só confia no próprio estado depois de saber o que a fila
  // guardou, e só diz "sem conexão" depois de uma tentativa falhar.
  describe('abertura e envio parado', () => {
    it('a fila só conta como aberta depois de ler o que estava guardado', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const antes = a.abrir();
      await antes.start('u1');
      await antes.enqueue({ kind: 'journey.end' });
      await antes.kick();

      const queue = a.abrir();
      expect(queue.getState().open).toBe(false);
      const abrindo = queue.start('u1');
      expect(queue.getState().open).toBe(false);
      await abrindo;

      expect(queue.getState().open).toBe(true);
      expect(queue.getState().items.map((i) => i.kind)).toEqual(['journey.end']);
      queue.stop();
      expect(queue.getState().open).toBe(false);
    });

    it('falha ao abrir a fila ainda conta como aberta, vazia', async () => {
      const a = aparelho();
      const queue = a.abrir();
      a.storage.write = jest.fn().mockRejectedValueOnce(new Error('disco'));
      a.storage.read = async () => JSON.stringify({ owner: 'outra-pessoa', items: [] });

      await expect(queue.start('u1')).rejects.toThrow('disco');

      expect(queue.getState()).toMatchObject({ items: [], open: true });
    });

    it('a tentativa que falha deixa a fila parada; a que passa solta', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(semRede());
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({ kind: 'journey.pause' });
      await queue.kick();
      expect(queue.getState().stalled).toBe(true);

      a.send.mockResolvedValue({ state: 'paused' });
      await queue.kick();
      expect(queue.getState()).toMatchObject({ items: [], stalled: false });
    });

    it('com sinal o envio sai e a fila nunca fica parada', async () => {
      const a = aparelho();
      const queue = a.abrir();
      await queue.start('u1');
      const parada: boolean[] = [];
      queue.subscribe(() => parada.push(queue.getState().stalled));

      await queue.enqueue({ kind: 'journey.pause' });
      await queue.kick();

      expect(parada).not.toContain(true);
      expect(queue.getState().items).toEqual([]);
    });

    it('sessão vencida (401) não conta como falta de sinal', async () => {
      const a = aparelho();
      a.send.mockRejectedValue(comStatus(401));
      const queue = a.abrir();
      await queue.start('u1');

      await queue.enqueue({ kind: 'journey.pause' });
      await queue.kick();

      expect(queue.getState()).toMatchObject({ stalled: false });
      expect(queue.getState().items).toHaveLength(1);
    });
  });

  describe('assinatura', () => {
    // useSyncExternalStore compara por referência: estado novo a cada leitura
    // seria render em laço.
    it('o estado só troca de referência quando muda', async () => {
      const queue = aparelho().abrir();
      await queue.start('u1');

      const a1 = queue.getState();
      const a2 = queue.getState();
      await queue.enqueue(mensagem());

      expect(a2).toBe(a1);
      expect(queue.getState()).not.toBe(a1);
    });

    it('quem cancela a assinatura para de ser avisado', async () => {
      const queue = aparelho().abrir();
      await queue.start('u1');
      const mudou = jest.fn();
      const evento = jest.fn();
      const pararMudou = queue.subscribe(mudou);
      const pararEvento = queue.onEvent(evento);

      pararMudou();
      pararEvento();
      await queue.enqueue(mensagem());
      await queue.kick();

      expect(mudou).not.toHaveBeenCalled();
      expect(evento).not.toHaveBeenCalled();
    });
  });
});
