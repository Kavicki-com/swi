import { File } from 'expo-file-system';
import { createHealthConnectReader } from './healthConnect/healthConnectReader';
import { sharedHealthConnectReader, sharedTelemetryOutbox } from './telemetryRuntime';

// Fila e leitor são únicos por runtime JS: duas filas sobre o mesmo arquivo
// apagariam eventos uma da outra, e o leitor do Health Connect avança o token
// depois de enfileirar, então o evento apagado assim não voltaria mais.

jest.mock('expo-file-system', () => ({
  File: jest.fn(() => ({ exists: false })),
  Paths: { document: 'documentos' },
}));
jest.mock('./healthConnect/healthConnectReader', () => ({
  createHealthConnectReader: jest.fn(() => ({ leitor: true })),
}));

const mockFile = File as unknown as jest.Mock;
const mockCreateReader = createHealthConnectReader as jest.MockedFunction<
  typeof createHealthConnectReader
>;

describe('telemetryRuntime', () => {
  // A suíte importa a fiação sem `expo-file-system` real: nada de arquivo no
  // topo do módulo, só na primeira chamada.
  it('importar não abre arquivo nem cria leitor', () => {
    expect(mockFile).not.toHaveBeenCalled();
    expect(mockCreateReader).not.toHaveBeenCalled();
  });

  it('a fila é a mesma instância em toda chamada, com um arquivo só', () => {
    const primeira = sharedTelemetryOutbox();
    const segunda = sharedTelemetryOutbox();
    expect(segunda).toBe(primeira);
    expect(mockFile).toHaveBeenCalledTimes(1);
  });

  it('o leitor do Health Connect é único e escreve na fila compartilhada', () => {
    const primeiro = sharedHealthConnectReader();
    const segundo = sharedHealthConnectReader();
    expect(segundo).toBe(primeiro);
    expect(mockCreateReader).toHaveBeenCalledTimes(1);
    expect(mockCreateReader).toHaveBeenCalledWith({ outbox: sharedTelemetryOutbox() });
  });
});
