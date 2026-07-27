import { validateBirthDate, validateExamDate } from './validators';

// Validade de exame é o INVERSO do nascimento: quase sempre está no futuro (as
// datas do Figma são 2027, 2029…), enquanto nascimento no futuro é erro. Sem um
// validador próprio, a tela de exames rejeitaria toda data válida.
describe('validateExamDate', () => {
  it('aceita validade futura — que o validador de nascimento recusa', () => {
    const futura = `05/03/${new Date().getFullYear() + 1}`;
    expect(validateExamDate(futura).valid).toBe(true);
    expect(validateBirthDate(futura).valid).toBe(false);
  });

  it('aceita exame já vencido (é um fato, não erro de digitação)', () => {
    expect(validateExamDate('10/01/2020').valid).toBe(true);
  });

  it('recusa formato fora de dd/mm/aaaa', () => {
    expect(validateExamDate('2027-03-05').valid).toBe(false);
    expect(validateExamDate('5/3/2027').valid).toBe(false);
    expect(validateExamDate('').valid).toBe(false);
  });

  it('recusa dia/mês impossíveis, respeitando ano bissexto', () => {
    expect(validateExamDate('31/02/2027').valid).toBe(false);
    expect(validateExamDate('00/03/2027').valid).toBe(false);
    expect(validateExamDate('05/13/2027').valid).toBe(false);
    expect(validateExamDate('29/02/2028').valid).toBe(true);  // bissexto
    expect(validateExamDate('29/02/2027').valid).toBe(false); // não bissexto
  });

  it('recusa ano absurdo (erro de digitação em vez de validade real)', () => {
    expect(validateExamDate('05/03/1200').valid).toBe(false);
    expect(validateExamDate('05/03/2999').valid).toBe(false);
  });
});
