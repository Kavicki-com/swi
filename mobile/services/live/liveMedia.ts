import type { LiveMedia } from './liveMedia.types';

// Substituto da câmera fora do Android e do iOS. O Metro escolhe
// liveMedia.native.ts para os dois e este arquivo para a web, que não
// transmite: o serviço trata a falta de câmera como falha ao ligar. Também é
// por este arquivo que o tsc resolve o caminho sem sufixo.
export const liveMedia: LiveMedia | null = null;
