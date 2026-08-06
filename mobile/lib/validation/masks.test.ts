import { maskBirthDate, maskCEP, maskCPF, maskPhone, maskUF } from './masks';

// As máscaras rodam DENTRO do onChangeText, a cada tecla. Duas propriedades
// importam mais que o formato final:
//   1. progressividade — a máscara não pode "pular na frente" de quem digita;
//   2. idempotência — reaplicar sobre o texto já formatado não pode corromper,
//      senão colar um valor pronto quebra o campo.
// Cada bloco abaixo testa os dois, além do teto de dígitos.

describe('maskCPF', () => {
  it('formata progressivamente conforme a pessoa digita', () => {
    expect(maskCPF('529')).toBe('529');
    expect(maskCPF('529982')).toBe('529.982');
    expect(maskCPF('529982247')).toBe('529.982.247');
    expect(maskCPF('52998224725')).toBe('529.982.247-25');
  });

  it('ignora o que não é dígito e corta no 11º', () => {
    expect(maskCPF('abc529')).toBe('529');
    expect(maskCPF('529982247259999')).toBe('529.982.247-25');
  });

  it('é idempotente: colar o valor já formatado devolve o mesmo', () => {
    expect(maskCPF('529.982.247-25')).toBe('529.982.247-25');
    expect(maskCPF('')).toBe('');
  });
});

describe('maskPhone', () => {
  it('abre o parêntese no DDD e fecha ao completar', () => {
    expect(maskPhone('1')).toBe('(1');
    expect(maskPhone('11')).toBe('(11');
    expect(maskPhone('1198')).toBe('(11) 98');
  });

  // Fixo (10) e celular (11) quebram o traço em posições diferentes.
  it('separa fixo de celular na posição certa do traço', () => {
    expect(maskPhone('1132654321')).toBe('(11) 3265-4321');
    expect(maskPhone('11987654321')).toBe('(11) 98765-4321');
  });

  it('vazio continua vazio e o 12º dígito é descartado', () => {
    expect(maskPhone('')).toBe('');
    expect(maskPhone('()  -')).toBe('');
    expect(maskPhone('119876543219')).toBe('(11) 98765-4321');
  });

  it('é idempotente sobre o valor já formatado', () => {
    expect(maskPhone('(11) 98765-4321')).toBe('(11) 98765-4321');
  });
});

describe('maskCEP', () => {
  it('só insere o traço a partir do 6º dígito', () => {
    expect(maskCEP('01001')).toBe('01001');
    expect(maskCEP('010010')).toBe('01001-0');
    expect(maskCEP('01001000')).toBe('01001-000');
  });

  it('corta no 8º dígito e é idempotente', () => {
    expect(maskCEP('010010009')).toBe('01001-000');
    expect(maskCEP('01001-000')).toBe('01001-000');
  });
});

describe('maskBirthDate', () => {
  it('insere as barras conforme dia, mês e ano vão entrando', () => {
    expect(maskBirthDate('05')).toBe('05');
    expect(maskBirthDate('0503')).toBe('05/03');
    expect(maskBirthDate('05031990')).toBe('05/03/1990');
  });

  it('corta no 8º dígito e é idempotente', () => {
    expect(maskBirthDate('050319901')).toBe('05/03/1990');
    expect(maskBirthDate('05/03/1990')).toBe('05/03/1990');
  });
});

describe('maskUF', () => {
  it('mantém só letras, em maiúscula, no máximo duas', () => {
    expect(maskUF('sp')).toBe('SP');
    expect(maskUF('s1p2')).toBe('SP');
    expect(maskUF('São Paulo')).toBe('SO'); // acento não é [A-Za-z]
    expect(maskUF('')).toBe('');
  });
});
