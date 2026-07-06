import type { Report, ReportInput, ReportsBackend, ReportsPage } from './types';
import { apiRequest } from '../api/http';
import { uploadImage } from '../api/uploadMedia';

// O backend já devolve o shape mobile `Report` pronto (imagens como URLs
// presigned, creationDate dd/mm/yyyy, null→'' coalescido), então não há fromApi.
export const apiReportsBackend: ReportsBackend = {
  list(page, limit) {
    return apiRequest<ReportsPage>(`/reports?page=${page}&limit=${limit}`, { auth: true });
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
};
