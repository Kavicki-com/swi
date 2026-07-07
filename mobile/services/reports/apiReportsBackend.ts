import type { Report, ReportComment, ReportInput, ReportsBackend, ReportUpdateInput } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// O backend já devolve o shape mobile `Report` pronto (imagens como URLs
// presigned, creationDate dd/mm/yyyy, null→'' coalescido), então não há fromApi.
export const apiReportsBackend: ReportsBackend = {
  list() {
    return apiRequest<Report[]>('/reports', { auth: true });
  },
  async get(id) {
    try {
      return await apiRequest<Report>(`/reports/${id}`, { auth: true });
    } catch (e) {
      if ((e as any).status === 404) return null; // 404 esperado; 500/rede propaga
      throw e;
    }
  },
  async create(input: ReportInput) {
    // Uploads em paralelo; Promise.all preserva a ordem das imagens.
    const imageKeys = await Promise.all(input.imageUris.map((uri) => uploadImage(uri)));
    return apiRequest<Report>('/reports', {
      method: 'POST',
      body: {
        title: input.title,
        summary: input.summary,
        details: input.details,
        responsibles: input.responsibles,
        imageKeys,
      },
      auth: true,
    });
  },
  // PATCH parcial: só os campos presentes entram no body (undefined não
  // sobrescreve no server). Imagens nunca entram — o server preserva as
  // imageKeys existentes (ver nota no ReportUpdateInput).
  async update(id: string, input: ReportUpdateInput) {
    const body: Record<string, unknown> = {};
    if (input.title !== undefined) body.title = input.title;
    if (input.summary !== undefined) body.summary = input.summary;
    if (input.details !== undefined) body.details = input.details;
    if (input.responsibles !== undefined) body.responsibles = input.responsibles;
    try {
      return await apiRequest<Report>(`/reports/${id}`, { method: 'PATCH', body, auth: true });
    } catch (e) {
      if ((e as any).status === 404) return null;
      throw e;
    }
  },
  async addComment(id: string, text: string) {
    try {
      return await apiRequest<ReportComment>(`/reports/${id}/comments`, {
        method: 'POST',
        body: { text },
        auth: true,
      });
    } catch (e) {
      if ((e as any).status === 404) return null;
      throw e;
    }
  },
};
