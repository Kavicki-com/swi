import { Platform } from 'react-native';
import { uuid } from 'expo-modules-core';
import { DATA_BACKEND } from '../../lib/featureFlags';
import { getChatBackend } from '../chat/getChatBackend';
import { getJourneyBackend } from '../journey/getJourneyBackend';
import { getReportsBackend } from '../reports/getReportsBackend';
import { createStagedSendFiles, passthroughSendFiles } from './sendFiles';
import { createFileSendStorage, createMemorySendStorage, createSendOutbox } from './sendOutbox';
import { createSendQueue, type SendQueue } from './sendQueue';
import { createSendTransport } from './sendTransport';

// A fila de envios do app: uma só, montada no primeiro uso. As telas não a
// constroem; chegam a ela pelos hooks de useSendQueue.ts.

let instance: SendQueue | null = null;

export function getSendQueue(): SendQueue {
  if (instance) return instance;

  const newId = () => uuid.v4();
  // Arquivo e cópia de foto só no aparelho com servidor de verdade. Na web não
  // há armazenamento do app, e no modo de demonstração a foto "enviada" é a
  // própria uri local, que não pode ser copiada e apagada.
  const durable = Platform.OS !== 'web' && DATA_BACKEND === 'api';

  instance = createSendQueue({
    outbox: createSendOutbox(durable ? createFileSendStorage() : createMemorySendStorage()),
    files: durable ? createStagedSendFiles(newId) : passthroughSendFiles,
    transport: createSendTransport({
      chat: getChatBackend(),
      reports: getReportsBackend(),
      journey: getJourneyBackend(),
    }),
    now: Date.now,
    newId,
  });
  return instance;
}
