import type { LiveNotice } from './liveBroadcast';

// Os avisos da câmera ao vivo no dashboard.

export const LIVE_NO_PERMISSION_TITLE =
  'Sem acesso à câmera. Libere a câmera para o SWI nos ajustes do aparelho.';
export const LIVE_FAILED_TITLE =
  'Não foi possível ligar a câmera ao vivo. Confira a conexão e tente de novo.';

export function liveNoticeTitle(notice: LiveNotice): string {
  return notice === 'no-permission' ? LIVE_NO_PERMISSION_TITLE : LIVE_FAILED_TITLE;
}
