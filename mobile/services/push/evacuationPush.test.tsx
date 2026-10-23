import { act, create } from 'react-test-renderer';
import { Text } from 'react-native';
import {
  announceEvacuationPush,
  combineEvacuationNotices,
  evacuationPushFromTask,
  readEvacuationPush,
  useEvacuationPushNotice,
} from './evacuationPush';

describe('readEvacuationPush', () => {
  it('lê o início e o fim da evacuação', () => {
    expect(readEvacuationPush({ type: 'evacuation.started', evacuationId: 'e1' })).toEqual({
      type: 'evacuation.started',
      evacuationId: 'e1',
    });
    expect(readEvacuationPush({ type: 'evacuation.ended', evacuationId: 'e1' })).toEqual({
      type: 'evacuation.ended',
      evacuationId: 'e1',
    });
  });

  it('aceita os dados em texto JSON, como chegam na tarefa', () => {
    expect(readEvacuationPush('{"type":"evacuation.ended","evacuationId":"e2"}')).toEqual({
      type: 'evacuation.ended',
      evacuationId: 'e2',
    });
  });

  // Outros tipos de push podem vir depois: não são da evacuação, e nada muda.
  it('qualquer outra coisa não é push da evacuação', () => {
    expect(readEvacuationPush(null)).toBeNull();
    expect(readEvacuationPush(undefined)).toBeNull();
    expect(readEvacuationPush('não é json')).toBeNull();
    expect(readEvacuationPush('"texto"')).toBeNull();
    expect(readEvacuationPush({ type: 'chat.message', evacuationId: 'e1' })).toBeNull();
    expect(readEvacuationPush({ type: 'evacuation.started' })).toBeNull();
    expect(readEvacuationPush({ type: 'evacuation.started', evacuationId: '' })).toBeNull();
    expect(readEvacuationPush({ type: 'evacuation.started', evacuationId: 7 })).toBeNull();
  });
});

describe('evacuationPushFromTask', () => {
  const ended = { type: 'evacuation.ended', evacuationId: 'e1' };

  // Android: o FCM entrega o `data` da Expo, com o nosso JSON em `body`, e o
  // expo-notifications copia para `dataString`.
  it('mensagem recebida no Android, só de dados', () => {
    const payload = {
      notification: null,
      data: { dataString: JSON.stringify(ended), body: JSON.stringify(ended), experienceId: '@x/swi' },
    };
    expect(evacuationPushFromTask(payload)).toEqual({ push: ended, tapped: false });
  });

  // iOS: o `body` chega como objeto, e o `dataString` é o mesmo em texto.
  it('mensagem recebida no iPhone, com o body em objeto', () => {
    const payload = { notification: null, data: { body: ended }, aps: { 'content-available': 1 } };
    expect(evacuationPushFromTask(payload)).toEqual({ push: ended, tapped: false });
  });

  // Android com o app em segundo plano ou fechado: o toque na notificação
  // chega à tarefa como resposta, com os dados no conteúdo da notificação.
  it('toque na notificação, com os dados em objeto ou em texto', () => {
    const started = { type: 'evacuation.started', evacuationId: 'e9' };
    const comObjeto = {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: { request: { content: { data: started } } },
    };
    const comTexto = {
      actionIdentifier: 'expo.modules.notifications.actions.DEFAULT',
      notification: { request: { content: { dataString: JSON.stringify(started) } } },
    };
    expect(evacuationPushFromTask(comObjeto)).toEqual({ push: started, tapped: true });
    expect(evacuationPushFromTask(comTexto)).toEqual({ push: started, tapped: true });
  });

  it('carga desconhecida ou vazia não é push da evacuação', () => {
    expect(evacuationPushFromTask(null)).toBeNull();
    expect(evacuationPushFromTask('x')).toBeNull();
    expect(evacuationPushFromTask({})).toBeNull();
    expect(evacuationPushFromTask({ data: { dataString: '{"type":"outro"}' } })).toBeNull();
    expect(evacuationPushFromTask({ actionIdentifier: 'a', notification: null })).toBeNull();
  });
});

describe('combineEvacuationNotices', () => {
  it('sem push, vale o aviso do socket como era', () => {
    expect(combineEvacuationNotices(null, null)).toBeNull();
    expect(combineEvacuationNotices('n2', null)).toBe('n2');
  });

  it('o push muda o aviso mesmo com o do socket parado', () => {
    expect(combineEvacuationNotices(null, 'p1')).toBe('push:p1');
    expect(combineEvacuationNotices('n2', 'p1')).toBe('n2|push:p1');
    expect(combineEvacuationNotices('n2', 'p2')).not.toBe(combineEvacuationNotices('n2', 'p1'));
  });
});

describe('useEvacuationPushNotice', () => {
  let seen: string | null = null;
  function Probe() {
    seen = useEvacuationPushNotice();
    return <Text>{seen ?? '-'}</Text>;
  }

  it('cada push anunciado muda o aviso', () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(<Probe />);
    });
    const before = seen;
    act(() => announceEvacuationPush('id-1'));
    const first = seen;
    expect(first).not.toBe(before);
    expect(first).toContain('id-1');
    // O mesmo id de novo (toque depois do recebimento) ainda é uma deixa nova.
    act(() => announceEvacuationPush('id-1'));
    expect(seen).not.toBe(first);
    act(() => tree.unmount());
  });
});
