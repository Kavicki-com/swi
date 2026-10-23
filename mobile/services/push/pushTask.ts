import type { EvacuationWindow } from '../positions/evacuationWindow';
import type { PositionTracking } from '../positions/positionTracking';
import { evacuationPushFromTask } from './evacuationPush';

// O que a tarefa do push faz com o app em segundo plano ou fechado. Roda sem
// interface, como a tarefa de localização: de quem é o rastreio vem da sessão
// salva, e ligar e desligar passam pelo mesmo controle da tela
// (positionTracking), que grava a evacuação em arquivo.
//
// Quais mensagens chegam aqui (documentação do expo-notifications do SDK 54):
// - só de dados (o fim da evacuação): no Android e no iPhone, com o app em
//   segundo plano ou fechado pelo sistema. Fechado à força pela pessoa, não.
// - com título (o início): o sistema mostra a notificação e a tarefa NÃO
//   roda. No Android, o toque nela chega aqui como resposta, e é por esse
//   toque que o rastreio liga com o app fechado.
//
// Ligar as leituras em segundo plano é o serviço em primeiro plano do
// Android, que o sistema pode recusar fora da janela de um push de prioridade
// alta ou sem a localização "o tempo todo". Recusado, a evacuação fica
// gravada (a tarefa de localização, se já estiver rodando pela jornada, passa
// a seguir a evacuação na próxima leitura) e a notificação visível continua
// lá: o toque abre o app, que liga o rastreio pelo caminho da tela.

/** O que a tarefa fez, para o teste e para o log. */
export type PushTaskOutcome = 'started' | 'ended' | 'ignored' | 'failed';

export interface PushTaskDeps {
  /** A pessoa da sessão salva, ou null sem sessão (logout). */
  readSession(): Promise<{ userId: string } | null>;
  /** A evacuação gravada pelo rastreio, para não encerrar outra. */
  readEvacuation(): Promise<EvacuationWindow | null>;
  tracking: Pick<PositionTracking, 'startEvacuation' | 'endEvacuation'>;
  /** Com o app na frente quem cuida é a tela (consulta e pede a permissão). */
  isForeground(): boolean;
}

export interface PushTaskHandler {
  handle(payload: unknown): Promise<PushTaskOutcome>;
}

export function createPushTaskHandler(deps: PushTaskDeps): PushTaskHandler {
  async function session(): Promise<{ userId: string } | null> {
    try {
      return await deps.readSession();
    } catch {
      return null;
    }
  }

  return {
    async handle(payload) {
      const found = evacuationPushFromTask(payload);
      if (!found || deps.isForeground()) return 'ignored';
      const owner = await session();
      if (!owner) return 'ignored';
      const { push } = found;

      if (push.type === 'evacuation.started') {
        try {
          const result = await deps.tracking.startEvacuation(owner.userId, push.evacuationId);
          return result === 'tracking' ? 'started' : 'failed';
        } catch {
          return 'failed';
        }
      }

      try {
        // O fim atrasado de uma evacuação antiga não apaga a nova.
        const stored = await deps.readEvacuation();
        if (stored && stored.evacuationId !== push.evacuationId) return 'ignored';
        await deps.tracking.endEvacuation();
        return 'ended';
      } catch {
        return 'failed';
      }
    },
  };
}
