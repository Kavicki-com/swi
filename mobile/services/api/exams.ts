import { apiRequest } from './http';
import { uploadImage } from './uploadMedia';

// Exames clínicos do worker. O card do design (ExamInfoCard) mostra ano, dia/mês
// e nome, então o backend guarda os três — só a chave do arquivo não desenha
// nada. `date` é a VALIDADE (as datas do Figma são futuras), informada pelo
// worker nos campos ao lado do botão de envio.
export interface Exam {
  id: string;
  name: string;
  /** Data de CALENDÁRIO 'AAAA-MM-DD' — nunca ISO com hora (o dia recuaria um
   *  em fuso negativo na hora de formatar). */
  date: string;
  fileUrl: string;
}

export function listExams(): Promise<Exam[]> {
  return apiRequest<Exam[]>('/profile/exams', { auth: true });
}

/**
 * Sobe o arquivo e cadastra o exame. São dois passos porque o upload vai
 * direto pro bucket via URL presigned — o backend só recebe a key no fim.
 */
export async function createExam(params: {
  name: string;
  date: string;
  fileUri: string;
}): Promise<Exam> {
  const fileKey = await uploadImage(params.fileUri, 'exams');
  return apiRequest<Exam>('/profile/exams', {
    method: 'POST',
    body: { name: params.name, date: params.date, fileKey },
    auth: true,
  });
}
