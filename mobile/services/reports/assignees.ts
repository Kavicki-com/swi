import { apiRequest } from '../api/http';
import { getChatBackend } from '../chat/getChatBackend';
import { DATA_BACKEND } from '../../lib/featureFlags';
import type { Contact } from '../chat/types';

/**
 * Quem pode ser atribuído como responsável por um relatório.
 *
 * A régua vive no backend (ReportsService.listAssignees + isStaffJobTitle):
 * staff da empresa, mais quem é ADMIN independentemente do cargo declarado.
 *
 * Não serve pedir isso ao `/chat/directory`. Aquele endpoint devolve a empresa
 * INTEIRA de propósito, porque sem os admins na lista o worker não teria como
 * iniciar conversa com o painel. Usá-lo aqui ofereceria todos os operadores
 * como revisores e divergiria da régua que o painel aplica.
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
