import {
  classifyFailure,
  createSendDrainer,
  SEND_MAX_AGE_MS,
  type SendTransport,
} from './sendDrain';
import { createSendOutbox, type SendItem } from './sendOutbox';
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
const haHoras = (horas: number) => new Date(AGORA - horas * 60 * 60 * 1000).toISOString();

const mensagem = (id: string, over: Partial<SendItem> = {}): SendItem =>
  ({
    id,
    kind: 'chat.message',
    createdAt: haHoras(0),
    conversationId: 'a#b',
    body: `texto ${id}`,
    images: [],
    ...over,
  }) as SendItem;

const relatorio = (id: string, fotos: string[]): SendItem => ({
  id,
  kind: 'report',
  createdAt: haHoras(0),
  title: `Relatório ${id}`,
  summary: 'Resumo',
  details: 'Detalhes',
  responsibles: [],
  images: fotos.map((localUri) => ({ localUri, key: null })),
});

// Recusa da API: o apiRequest marca `apiError` quando o corpo é o do Nest.
const comStatus = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, apiError: true });
// O mesmo status respondido por algo no caminho (proxy, túnel parado).
const doCaminho = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status, apiError: false });
const semRede = () => new TypeError('Network request failed');
const prazo = () => Object.assign(new Error('Tempo esgotado'), { code: 'TIMEOUT' });

async function cenario(itens: SendItem[]) {
  const outbox = createSendOutbox(memoryStorage());
  for (const item of itens) await outbox.append('u1', item);
  const upload = jest.fn(async (_item: SendItem, localUri: string) => `key:${localUri}`);
  const send = jest.fn(async (item: SendItem): Promise<unknown> => ({ servidor: item.id }));
  const transport: SendTransport = { upload, send };
  const onSent = jest.fn();
  const onRefused = jest.fn();
  // A sessão de quem abriu a rodada: `aberta = false` é a pessoa ter saído.
  const sessao = { aberta: true };
  const drainer = createSendDrainer({
    outbox,
    transport,
    now: () => AGORA,
    isCurrent: () => sessao.aberta,
    onSent,
    onRefused,
  });
  const fila = async () => (await outbox.pending('u1')).map((i) => i.id);
  return { outbox, upload, send, onSent, onRefused, drainer, fila, sessao };
}

describe('classifyFailure', () => {
  it.each([400, 403, 404, 409, 413, 415, 422])('%i nunca vai passar: recusa', (status) => {
    expect(classifyFailure(comStatus(status))).toBe('refuse');
  });

  it.each([408, 429, 500, 502, 503])('%i é passageiro: espera', (status) => {
    expect(classifyFailure(comStatus(status))).toBe('wait');
  });

  it('sem rede e prazo esgotado esperam', () => {
    expect(classifyFailure(semRede())).toBe('wait');
    expect(classifyFailure(prazo())).toBe('wait');
    expect(classifyFailure(null)).toBe('wait');
  });

  // Túnel parado responde 404 e um firewall responde 403, sem a API ter visto
  // o envio. Descartar aí seria perder o que a pessoa escreveu.
  it.each([403, 404])('%i que não veio da API é passageiro: espera', (status) => {
    expect(classifyFailure(doCaminho(status))).toBe('wait');
    expect(classifyFailure(Object.assign(new Error('x'), { status }))).toBe('wait');
  });

  it('401 para o envio: a sessão não vale mais', () => {
    expect(classifyFailure(comStatus(401))).toBe('unauthorized');
  });

  it('foto que sumiu do aparelho nunca vai subir: recusa', () => {
    expect(classifyFailure(Object.assign(new Error('sumiu'), { code: 'FILE_MISSING' }))).toBe('refuse');
  });
});

describe('createSendDrainer', () => {
  it('fila vazia não toca a rede', async () => {
    const c = await cenario([]);

    expect(await c.drainer.drain('u1')).toBe('empty');
    expect(c.send).not.toHaveBeenCalled();
  });

  it('envia um item por vez, na ordem, e tira cada um da fila ao confirmar', async () => {
    const c = await cenario([mensagem('m1'), mensagem('m2'), mensagem('m3')]);
    const ordem: string[] = [];
    let emVoo = 0;
    c.send.mockImplementation(async (item) => {
      emVoo += 1;
      expect(emVoo).toBe(1);
      await Promise.resolve();
      ordem.push(item.id);
      emVoo -= 1;
      return { servidor: item.id };
    });

    expect(await c.drainer.drain('u1')).toBe('sent');

    expect(ordem).toEqual(['m1', 'm2', 'm3']);
    expect(await c.fila()).toEqual([]);
    expect(c.onSent.mock.calls.map(([item, result]) => [item.id, result])).toEqual([
      ['m1', { servidor: 'm1' }],
      ['m2', { servidor: 'm2' }],
      ['m3', { servidor: 'm3' }],
    ]);
  });

  describe('fotos', () => {
    it('sobe cada foto uma vez e o POST leva as keys', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg', 'file:///b.jpg'])]);

      await c.drainer.drain('u1');

      expect(c.upload.mock.calls.map(([, uri]) => uri)).toEqual(['file:///a.jpg', 'file:///b.jpg']);
      expect(c.send.mock.calls[0][0].images).toEqual([
        { localUri: 'file:///a.jpg', key: 'key:file:///a.jpg' },
        { localUri: 'file:///b.jpg', key: 'key:file:///b.jpg' },
      ]);
    });

    // O contrato com o backend: o reenvio leva exatamente o mesmo corpo. A key
    // da foto que já subiu fica no item, e a tentativa seguinte não sobe de novo.
    it('o POST falhou depois do upload: a nova tentativa reusa a key e manda o mesmo corpo', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg'])]);
      c.send.mockRejectedValueOnce(semRede());

      expect(await c.drainer.drain('u1')).toBe('waiting');
      expect(await c.drainer.drain('u1')).toBe('sent');

      expect(c.upload).toHaveBeenCalledTimes(1);
      expect(c.send).toHaveBeenCalledTimes(2);
      expect(c.send.mock.calls[1][0]).toEqual(c.send.mock.calls[0][0]);
    });

    it('a segunda foto falhou: a primeira não sobe de novo', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg', 'file:///b.jpg'])]);
      c.upload.mockResolvedValueOnce('reports/a.jpg').mockRejectedValueOnce(semRede());

      expect(await c.drainer.drain('u1')).toBe('waiting');
      expect(c.send).not.toHaveBeenCalled();

      await c.drainer.drain('u1');

      expect(c.upload.mock.calls.map(([, uri]) => uri)).toEqual([
        'file:///a.jpg',
        'file:///b.jpg',
        'file:///b.jpg',
      ]);
      expect(c.send.mock.calls[0][0].images.map((i) => i.key)).toEqual([
        'reports/a.jpg',
        'key:file:///b.jpg',
      ]);
    });
  });

  // A rodada pertence à sessão que a abriu. A pessoa sai no meio de um upload
  // (que pode levar mais de um minuto com sinal fraco): quando ele termina, o
  // POST sairia com o token de quem entrou depois.
  describe('sessão encerrada no meio da rodada', () => {
    it('saiu durante o upload: a key não é gravada e o POST não sai', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg'])]);
      c.upload.mockImplementationOnce(async () => {
        c.sessao.aberta = false;
        return 'reports/a.jpg';
      });

      expect(await c.drainer.drain('u1')).toBe('waiting');

      expect(c.send).not.toHaveBeenCalled();
      expect(c.onSent).not.toHaveBeenCalled();
      expect(c.onRefused).not.toHaveBeenCalled();
      const [item] = await c.outbox.pending('u1');
      expect(item.images[0].key).toBeNull();
    });

    it('saiu entre um item e outro: o seguinte não é enviado', async () => {
      const c = await cenario([mensagem('m1'), mensagem('m2')]);
      c.send.mockImplementationOnce(async () => {
        c.sessao.aberta = false;
        return { servidor: 'm1' };
      });

      await c.drainer.drain('u1');

      expect(c.send).toHaveBeenCalledTimes(1);
      expect(await c.fila()).toEqual(['m2']);
    });

    it('sessão já encerrada: a rodada não toca a rede', async () => {
      const c = await cenario([mensagem('m1')]);
      c.sessao.aberta = false;

      expect(await c.drainer.drain('u1')).toBe('waiting');

      expect(c.send).not.toHaveBeenCalled();
    });

    // O item saiu da fila enquanto a foto subia (outra pessoa tomou a fila).
    // Sem lugar para gravar a key, o envio não é mais desta rodada.
    it('a key não pôde ser gravada: o POST não sai', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg'])]);
      c.upload.mockImplementationOnce(async () => {
        await c.outbox.claim('u2');
        return 'reports/a.jpg';
      });

      expect(await c.drainer.drain('u1')).toBe('waiting');

      expect(c.send).not.toHaveBeenCalled();
      expect(c.onRefused).not.toHaveBeenCalled();
    });
  });

  describe('falhas', () => {
    it.each([
      ['sem rede', semRede()],
      ['prazo esgotado', prazo()],
      ['503', comStatus(503)],
      ['429', comStatus(429)],
    ])('%s: para a rodada, guarda tudo e não avisa', async (_nome, erro) => {
      const c = await cenario([mensagem('m1'), mensagem('m2')]);
      c.send.mockRejectedValueOnce(erro);

      expect(await c.drainer.drain('u1')).toBe('waiting');

      expect(c.send).toHaveBeenCalledTimes(1);
      expect(await c.fila()).toEqual(['m1', 'm2']);
      expect(c.onRefused).not.toHaveBeenCalled();
    });

    it('4xx de algo no caminho, e não da API: guarda o item e não avisa', async () => {
      const c = await cenario([mensagem('m1')]);
      c.send.mockRejectedValueOnce(doCaminho(404));

      expect(await c.drainer.drain('u1')).toBe('waiting');

      expect(await c.fila()).toEqual(['m1']);
      expect(c.onRefused).not.toHaveBeenCalled();
    });

    it('recusa do servidor: descarta o item, avisa e segue para o próximo', async () => {
      const c = await cenario([mensagem('m1'), mensagem('m2')]);
      c.send.mockRejectedValueOnce(comStatus(422));

      expect(await c.drainer.drain('u1')).toBe('sent');

      expect(await c.fila()).toEqual([]);
      expect(c.onRefused).toHaveBeenCalledTimes(1);
      expect(c.onRefused.mock.calls[0][0].id).toBe('m1');
      expect(c.onRefused.mock.calls[0][1]).toBe('rejected');
      expect(c.onSent.mock.calls.map(([item]) => item.id)).toEqual(['m2']);
    });

    it('401: para e guarda tudo, sem descartar', async () => {
      const c = await cenario([mensagem('m1'), mensagem('m2')]);
      c.send.mockRejectedValueOnce(comStatus(401));

      expect(await c.drainer.drain('u1')).toBe('unauthorized');

      expect(await c.fila()).toEqual(['m1', 'm2']);
      expect(c.onRefused).not.toHaveBeenCalled();
    });

    it('presign recusado (400) descarta o item sem tentar o POST', async () => {
      const c = await cenario([relatorio('r1', ['file:///a.jpg'])]);
      c.upload.mockRejectedValueOnce(comStatus(400));

      await c.drainer.drain('u1');

      expect(c.send).not.toHaveBeenCalled();
      expect(await c.fila()).toEqual([]);
      expect(c.onRefused.mock.calls[0][1]).toBe('rejected');
    });
  });

  // Um item que nunca passa travaria a fila inteira para sempre: não há tela
  // para cancelar, e o app não tem atualização remota.
  describe('validade', () => {
    it('item com mais de 72 h sai sem tocar a rede, com o motivo certo', async () => {
      const c = await cenario([mensagem('velha', { createdAt: haHoras(73) }), mensagem('nova')]);

      expect(await c.drainer.drain('u1')).toBe('sent');

      expect(c.send.mock.calls.map(([item]) => item.id)).toEqual(['nova']);
      expect(c.onRefused.mock.calls[0][0].id).toBe('velha');
      expect(c.onRefused.mock.calls[0][1]).toBe('expired');
    });

    it('item com menos de 72 h ainda é enviado', async () => {
      expect(SEND_MAX_AGE_MS).toBe(72 * 60 * 60 * 1000);
      const c = await cenario([mensagem('m1', { createdAt: haHoras(71) })]);

      await c.drainer.drain('u1');

      expect(c.onSent).toHaveBeenCalledTimes(1);
    });

    it('data ilegível vale como vencida', async () => {
      const c = await cenario([mensagem('m1', { createdAt: 'ontem' })]);

      await c.drainer.drain('u1');

      expect(c.send).not.toHaveBeenCalled();
      expect(c.onRefused.mock.calls[0][1]).toBe('expired');
    });
  });

  describe('rodadas', () => {
    it('duas chamadas juntas não mandam o mesmo item duas vezes', async () => {
      const c = await cenario([mensagem('m1')]);

      await Promise.all([c.drainer.drain('u1'), c.drainer.drain('u1')]);

      expect(c.send).toHaveBeenCalledTimes(1);
    });

    // O item que entra enquanto a rodada está no último POST não espera os
    // 15 s do relógio.
    it('item que entra durante a rodada sai na mesma rodada', async () => {
      const c = await cenario([mensagem('m1')]);
      let soltar!: () => void;
      c.send.mockImplementationOnce(
        () => new Promise((resolve) => (soltar = () => resolve({ servidor: 'm1' }))),
      );

      const rodada = c.drainer.drain('u1');
      await new Promise((r) => setTimeout(r, 0));
      await c.outbox.append('u1', mensagem('m2'));
      const pedido = c.drainer.drain('u1');
      soltar();
      await Promise.all([rodada, pedido]);

      expect(c.send.mock.calls.map(([item]) => item.id)).toEqual(['m1', 'm2']);
      expect(await c.fila()).toEqual([]);
    });

    it('depois de uma rodada que parou, a próxima tenta de novo', async () => {
      const c = await cenario([mensagem('m1')]);
      c.send.mockRejectedValueOnce(semRede());

      await c.drainer.drain('u1');
      expect(await c.drainer.drain('u1')).toBe('sent');
    });

    // A pessoa saiu e outra entrou no meio do envio: o envio antigo não toca
    // nos itens de quem está logado agora.
    it('o envio de quem saiu não envia nem apaga itens de quem entrou', async () => {
      const c = await cenario([mensagem('m1')]);
      await c.outbox.claim('u2');
      await c.outbox.append('u2', mensagem('de-u2'));

      expect(await c.drainer.drain('u1')).toBe('empty');

      expect(c.send).not.toHaveBeenCalled();
      expect((await c.outbox.pending('u2')).map((i) => i.id)).toEqual(['de-u2']);
    });
  });
});
