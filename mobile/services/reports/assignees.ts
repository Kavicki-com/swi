import { apiRequest } from '../api/http';
import { getChatBackend } from '../chat/getChatBackend';
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { Contact } from '../chat/types';

/**
 * Quem pode ser atribuído como responsável por um relatório.
 *
 * Até 2026-07-27 o modal pedia isso ao `/chat/directory`. Aquele endpoint
 * devolve a empresa INTEIRA de propósito — sem os admins na lista o worker não
 * tinha como iniciar conversa com o painel (decisão 2026-07-26). O efeito
 * colateral: o seletor de responsáveis oferecia os 10 operadores como
 * revisores, e o painel usava outra régua (adminsApi), então os dois seletores
 * divergiam.
 *
 * A régua agora vive no backend (ReportsService.listAssignees + isStaffJobTitle):
 * staff da empresa, mais quem é ADMIN independentemente do cargo declarado.
 */
export function listReportAssignees(): Promise<Contact[]> {
  if (DATA_BACKEND === 'api') {
    return apiRequest<Contact[]>('/reports/assignees', { auth: true });
  }
  // O backend mock não tem quadro de staff. Sem este fallback o dev local
  // (DATA_BACKEND é 'mock' por padrão) abriria o modal vazio — a régua real só
  // vale onde existe backend.
  return getChatBackend().listDirectory();
}
