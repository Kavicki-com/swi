import {
  validateBirthDate,
  validateCEP,
  validateCPF,
  validateEmail,
  validateExamDate,
  validateFullName,
  validatePasswordField,
  validatePasswordMatch,
  validatePhone,
  validateRequired,
  validateUF,
} from './validators';

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

// O resto do módulo. Cada validador é a última barreira antes de um cadastro ir
// pro backend, e a mensagem devolvida é literalmente o texto que a pessoa lê
// embaixo do campo — por isso os testes conferem a mensagem, não só `valid`.

describe('validateRequired', () => {
  it('aceita qualquer conteúdo não vazio', () => {
    expect(validateRequired('a')).toEqual({ valid: true });
  });

  it('trata espaço em branco como vazio', () => {
    expect(validateRequired('   ')).toEqual({ valid: false, error: 'Campo é obrigatório' });
  });

  it('usa o rótulo do campo na mensagem quando informado', () => {
    expect(validateRequired('', 'Cargo').error).toBe('Cargo é obrigatório');
  });
});

describe('validateEmail', () => {
  it('aceita endereço comum, ignorando espaço nas pontas', () => {
    expect(validateEmail('  pessoa@empresa.com.br  ').valid).toBe(true);
  });

  it('distingue vazio de inválido: são mensagens diferentes', () => {
    expect(validateEmail('   ').error).toBe('Email é obrigatório');
    expect(validateEmail('pessoa@empresa').error).toBe('Email inválido');
  });

  it.each(['sem-arroba.com', 'a@b.c', 'a b@empresa.com', 'a@@empresa.com'])(
    'recusa %s',
    (v) => { expect(validateEmail(v).valid).toBe(false); },
  );
});

describe('validateFullName', () => {
  it('aceita nome e sobrenome, com espaços repetidos no meio', () => {
    expect(validateFullName('Ana   Souza').valid).toBe(true);
  });

  it('vazio pede o campo; um nome só pede o completo', () => {
    expect(validateFullName('  ').error).toBe('Nome é obrigatório');
    expect(validateFullName('Ana').error).toBe('Informe seu nome completo');
  });

  // Barra a inicial abreviada: "Ana S" não identifica ninguém no relatório.
  it('recusa parte com uma única letra', () => {
    expect(validateFullName('Ana S').valid).toBe(false);
    expect(validateFullName('A Souza').valid).toBe(false);
  });
});

describe('validatePhone', () => {
  it('aceita fixo (10) e celular (11), com máscara ou sem', () => {
    expect(validatePhone('(11) 98765-4321').valid).toBe(true);
    expect(validatePhone('1132654321').valid).toBe(true);
  });

  it('vazio, comprimento errado e DDD inexistente têm mensagens distintas', () => {
    expect(validatePhone('()  -').error).toBe('Telefone é obrigatório');
    expect(validatePhone('119876543').error).toBe('Telefone inválido');
    expect(validatePhone('0212345678').error).toBe('DDD inválido');
  });

  it('aceita as pontas da faixa de DDD (11 e 99)', () => {
    expect(validatePhone('1112345678').valid).toBe(true);
    expect(validatePhone('9912345678').valid).toBe(true);
  });
});

describe('validateCPF', () => {
  it('aceita CPF válido com e sem máscara', () => {
    expect(validateCPF('529.982.247-25').valid).toBe(true);
    expect(validateCPF('52998224725').valid).toBe(true);
  });

  it('vazio e comprimento errado não são "CPF inválido"', () => {
    expect(validateCPF('').error).toBe('CPF é obrigatório');
    expect(validateCPF('5299822472').error).toBe('CPF deve ter 11 dígitos');
  });

  // Sequência repetida passa a conta dos dígitos verificadores; a regra do
  // repetido existe só pra barrar 111.111.111-11 e companhia.
  it('recusa todos os dígitos iguais', () => {
    expect(validateCPF('11111111111').error).toBe('CPF inválido');
  });

  it('recusa erro no primeiro e no segundo dígito verificador', () => {
    expect(validateCPF('52998224735').error).toBe('CPF inválido'); // 1º dígito
    expect(validateCPF('52998224726').error).toBe('CPF inválido'); // 2º dígito
  });

  // Resto 10 vira dígito 0: os dois CPFs abaixo passam por esse ramo, um em
  // cada dígito verificador. Sem eles a conversão de 10 pra 0 fica sem prova.
  it('aceita CPF cujo dígito verificador vem de resto 10 (vira 0)', () => {
    expect(validateCPF('10000000108').valid).toBe(true); // 1º dígito
    expect(validateCPF('10000002810').valid).toBe(true); // 2º dígito
  });
});

describe('validateCEP', () => {
  it('aceita 8 dígitos com e sem máscara', () => {
    expect(validateCEP('01001-000').valid).toBe(true);
    expect(validateCEP('01001000').valid).toBe(true);
  });

  it('separa vazio de comprimento errado', () => {
    expect(validateCEP('-').error).toBe('CEP é obrigatório');
    expect(validateCEP('0100100').error).toBe('CEP deve ter 8 dígitos');
  });
});

describe('validateUF', () => {
  it('aceita as 27 UFs, em qualquer caixa e com espaço nas pontas', () => {
    expect(validateUF(' sp ').valid).toBe(true);
    expect(validateUF('DF').valid).toBe(true);
  });

  it('vazio, tamanho errado e sigla inexistente têm mensagens distintas', () => {
    expect(validateUF('  ').error).toBe('UF é obrigatória');
    expect(validateUF('SPO').error).toBe('UF deve ter 2 letras');
    expect(validateUF('XX').error).toBe('UF inválida');
  });
});

describe('validateBirthDate', () => {
  it('aceita data de calendário válida no passado', () => {
    expect(validateBirthDate('29/02/2000').valid).toBe(true); // século bissexto
    expect(validateBirthDate('28/02/1900').valid).toBe(true); // 1900 NÃO é bissexto
  });

  it('recusa 29/02 em ano não bissexto de virada de século', () => {
    expect(validateBirthDate('29/02/1900').error).toBe('Dia inválido');
  });

  it('recusa formato, ano fora da faixa, mês e dia impossíveis', () => {
    expect(validateBirthDate('1990-05-03').error).toBe('Data inválida (dd/mm/aaaa)');
    expect(validateBirthDate('03/05/1899').error).toBe('Ano inválido');
    expect(validateBirthDate(`03/05/${new Date().getFullYear() + 1}`).error).toBe('Ano inválido');
    expect(validateBirthDate('03/00/1990').error).toBe('Mês inválido');
    expect(validateBirthDate('32/01/1990').error).toBe('Dia inválido');
  });
});

describe('validatePasswordField', () => {
  it('aceita senha que cumpre as quatro regras', () => {
    expect(validatePasswordField('Segura1@').valid).toBe(true);
  });

  // A mensagem aponta a PRIMEIRA regra quebrada, na ordem tamanho → letras e
  // números → maiúscula → símbolo. É o que guia a pessoa a corrigir.
  it.each([
    ['', 'Senha é obrigatória'],
    ['Ab1@', 'Mínimo 8 caracteres'],
    ['Abcdefgh', 'Use letras e números'],
    ['abcdefg1', 'Use ao menos 1 maiúscula'],
    ['Abcdefg1', 'Use ao menos 1 símbolo (@#$%^)'],
  ])('para %p aponta %p', (senha, mensagem) => {
    expect(validatePasswordField(senha).error).toBe(mensagem);
  });
});

describe('validatePasswordMatch', () => {
  it('aceita confirmação idêntica', () => {
    expect(validatePasswordMatch('Segura1@', 'Segura1@').valid).toBe(true);
  });

  it('confirmação vazia pede confirmar; diferente avisa que não coincide', () => {
    expect(validatePasswordMatch('Segura1@', '').error).toBe('Confirme a senha');
    expect(validatePasswordMatch('Segura1@', 'Segura1#').error).toBe('As senhas não coincidem');
  });
});
