import type { Exam } from './exams';

// 'AAAA-MM-DD' → as partes que o ExamInfoCard do DS pede: ano separado do
// dia/mês abreviado ("2027" + "05 Mar").
//
// Fatia o texto em vez de usar Date: a validade é data de CALENDÁRIO, e
// `new Date('2027-03-05')` é meia-noite UTC — em UTC-3 os getters locais
// voltam pro dia 4. Mesma pegadinha que já mordeu o cálculo de idade.
const MESES = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];

export interface ExamCardParts {
  year: string;
  date: string;
  /** Indica validade ainda no futuro para definir o peso visual do ano. */
  future: boolean;
}

export function examCardParts(exam: Exam, today = new Date()): ExamCardParts {
  const [y, m, d] = exam.date.split('-');
  const mes = MESES[Number(m) - 1] ?? '';
  const hojeISO = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(
    today.getDate(),
  ).padStart(2, '0')}`;
  return {
    year: y ?? '',
    date: `${d ?? ''} ${mes}`.trim(),
    // Comparação de texto entre datas ISO é cronológica — sem Date, sem fuso.
    future: exam.date > hojeISO,
  };
}
