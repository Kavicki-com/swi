import { examCardParts } from './examCard';
import type { Exam } from './exams';

const exam = (date: string): Exam => ({
  id: 'e1',
  name: 'Exame de reciclagem técnica',
  date,
  fileUrl: 'https://s3/view/exams/e1.jpg',
});

// "Hoje" sempre local: com meia-noite UTC o teste passaria a depender do fuso
// da máquina (em UTC-3 o dia local seria o anterior).
const HOJE = new Date(2026, 6, 26, 12, 0, 0); // 26/07/2026

describe('examCardParts', () => {
  it('separa ano e dia/mês abreviado, como o card do Figma pede', () => {
    expect(examCardParts(exam('2027-03-05'), HOJE)).toMatchObject({
      year: '2027',
      date: '05 Mar',
    });
    expect(examCardParts(exam('2029-11-19'), HOJE).date).toBe('19 Nov');
  });

  it('marca como futuro só o que ainda não venceu', () => {
    expect(examCardParts(exam('2027-03-05'), HOJE).future).toBe(true);
    expect(examCardParts(exam('2020-01-10'), HOJE).future).toBe(false);
    // Vence hoje ainda não é futuro.
    expect(examCardParts(exam('2026-07-26'), HOJE).future).toBe(false);
    expect(examCardParts(exam('2026-07-27'), HOJE).future).toBe(true);
  });

  it('não deixa o fuso mover o dia (a validade é data de calendário)', () => {
    // 01/03 em UTC-3 viraria "28 Fev" se passasse por new Date().
    expect(examCardParts(exam('2027-03-01'), HOJE).date).toBe('01 Mar');
  });
});
