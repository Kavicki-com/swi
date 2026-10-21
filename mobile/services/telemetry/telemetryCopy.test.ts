import {
  bandDetectedCopy,
  HEALTH_CONNECT_PAIRING_COPY,
  healthConnectInstallCopy,
  pairingCopy,
  pairingFailureCopy,
  SYNC_BANNER_COPY,
  watchProtocolCopy,
  telemetryCopy,
  telemetryUploadCopy,
} from './telemetryCopy';
import type { TelemetryAvailability } from './telemetryAvailability';

// Fonte unica da copy: as duas superficies precisam dizer a mesma coisa sobre o
// mesmo estado. Titulo diferente para o mesmo estado faria o funcionario achar
// que sao dois problemas.

const TODOS: TelemetryAvailability[] = [
  { kind: 'unsupported' },
  { kind: 'unavailable' },
  { kind: 'awaiting' },
  { kind: 'stale', bpm: 70, measuredAt: '2026-09-02T13:00:00.000Z' },
  { kind: 'current', bpm: 70, measuredAt: '2026-09-02T13:00:00.000Z' },
];

describe('telemetryCopy', () => {
  it('o titulo de um estado nao muda entre o primeiro uso e Configuracoes', () => {
    for (const estado of TODOS) {
      expect(telemetryCopy(estado, 'primeiro-uso').titulo).toBe(
        telemetryCopy(estado, 'configuracoes').titulo,
      );
    }
  });

  it('cada estado tem titulo proprio: nenhum se confunde com outro', () => {
    const titulos = TODOS.map((e) => telemetryCopy(e, 'configuracoes').titulo);
    expect(new Set(titulos).size).toBe(TODOS.length);
  });

  // CONTEXT.md: "indisponivel" nomeia o estado COM suporte e sem leitura. Usar
  // a mesma palavra para sem suporte daria o conselho errado.
  it('sem suporte nao usa a palavra reservada ao estado indisponivel', () => {
    expect(telemetryCopy({ kind: 'unsupported' }, 'configuracoes').titulo).not.toMatch(
      /indisponível/i,
    );
    expect(telemetryCopy({ kind: 'unsupported' }, 'configuracoes').corpo).toMatch(
      /iPhone e Apple Watch/,
    );
  });

  it('aguardando manda ajustar o pulso; indisponivel manda ao sistema', () => {
    expect(telemetryCopy({ kind: 'awaiting' }, 'configuracoes').corpo).toMatch(/pulso/);
    expect(telemetryCopy({ kind: 'awaiting' }, 'configuracoes').corpo).not.toMatch(/Ajustes/);
    expect(telemetryCopy({ kind: 'unavailable' }, 'configuracoes').corpo).toMatch(/Ajustes/);
  });

  it('a acao muda com o contexto: uma aponta Configuracoes, a outra o botao', () => {
    expect(telemetryCopy({ kind: 'unavailable' }, 'primeiro-uso').corpo).toMatch(/Configurações/);
    expect(telemetryCopy({ kind: 'unavailable' }, 'configuracoes').corpo).toMatch(
      /Ativar monitoramento/,
    );
  });

  // ADR-0004 e CONTEXT.md.
  it('nenhum estado acusa negacao nem cita smartband', () => {
    for (const estado of TODOS) {
      for (const contexto of ['primeiro-uso', 'configuracoes'] as const) {
        const { titulo, corpo } = telemetryCopy(estado, contexto);
        const t = `${titulo} ${corpo}`.toLowerCase();
        expect(t).not.toContain('negad');
        expect(t).not.toContain('negou');
        expect(t).not.toContain('smartband');
      }
    }
  });
});

describe('telemetryUploadCopy', () => {
  // A linha de envio da tela de monitoramento: pareado envia; sem pareamento
  // diz isso, e não "erro", porque parear é ação do administrador no painel.
  it('distingue pareado de não pareado', () => {
    expect(telemetryUploadCopy(true)).toBe('Enviando ao servidor');
    expect(telemetryUploadCopy(false)).toBe('Aparelho não pareado');
  });
});

describe('aviso de relógio desatualizado', () => {
  it('avisa quando o relógio ainda fala o formato antigo', () => {
    expect(watchProtocolCopy('legacy')).toBe(
      'O app do relógio ainda não atualizou. Abra o SWI no Apple Watch.',
    );
  });

  it('não diz nada quando o relógio já está no formato novo', () => {
    // Estado normal não merece aviso: uma tela cheia de linhas verdes esconde
    // a única que importa.
    expect(watchProtocolCopy('v1')).toBeNull();
  });

  it('não diz nada antes de o relógio falar', () => {
    // Ausência de informação não é problema do funcionário, e afirmar que o
    // relógio está desatualizado sem saber seria inventar.
    expect(watchProtocolCopy(null)).toBeNull();
  });
});

describe('pairingFailureCopy', () => {
  // As quatro recusas do backend, cada uma com o seu conselho.
  it.each([
    ['expired', 'Este código expirou. Peça um novo ao administrador.'],
    [
      'already_used',
      'Este código já foi usado. Se este aparelho já está pareado, não é preciso repetir.',
    ],
    ['invalid_code', 'Código não confere. Confira os seis dígitos com o administrador.'],
    ['unsupported_device', 'Este aparelho não pode ser pareado.'],
  ] as const)('%s', (reason, frase) => {
    expect(pairingFailureCopy(reason)).toBe(frase);
  });

  it('falha de rede e limite de tentativas não culpam o código', () => {
    expect(pairingFailureCopy('network')).not.toMatch(/código/i);
    expect(pairingFailureCopy('rate_limited')).toMatch(/aguarde/i);
  });

  // A credencial do Android mora no SecureStore, não no chaveiro do iPhone.
  it('keychain fala do aparelho certo: iPhone por padrão, celular no Android', () => {
    expect(pairingFailureCopy('keychain')).toBe(
      'Não foi possível guardar o pareamento neste iPhone. Tente de novo.',
    );
    expect(pairingFailureCopy('keychain', 'IPHONE')).toBe(pairingFailureCopy('keychain'));
    expect(pairingFailureCopy('keychain', 'ANDROID_PHONE')).toBe(
      'Não foi possível guardar o pareamento neste celular. Tente de novo.',
    );
  });

  it('no Android nenhum motivo cita iPhone, e as recusas do backend não mudam', () => {
    for (const m of [
      'unsupported',
      'unauthorized',
      'invalid_code',
      'expired',
      'already_used',
      'unsupported_device',
      'keychain',
      'network',
      'rate_limited',
      'unexpected',
    ] as const) {
      expect(pairingFailureCopy(m, 'ANDROID_PHONE')).not.toMatch(/iPhone/);
      if (m !== 'keychain') {
        expect(pairingFailureCopy(m, 'ANDROID_PHONE')).toBe(pairingFailureCopy(m));
      }
    }
  });

  it('todo motivo tem frase', () => {
    const motivos = [
      'unsupported',
      'unauthorized',
      'invalid_code',
      'expired',
      'already_used',
      'unsupported_device',
      'keychain',
      'network',
      'rate_limited',
      'unexpected',
    ] as const;
    for (const m of motivos) expect(pairingFailureCopy(m).length).toBeGreaterThan(10);
  });
});

describe('pairingCopy', () => {
  // O iPhone fica exatamente como sempre foi.
  it('no iPhone, por padrão, a copy de sempre', () => {
    expect(pairingCopy()).toEqual({
      titulo: 'Parear este iPhone',
      instrucao:
        'Peça ao administrador o código de pareamento de seis dígitos, gerado no painel, e digite abaixo. O código vale por dez minutos.',
      pareadoTitulo: 'Aparelho pareado',
      pareadoCorpo: 'As leituras do seu Apple Watch passam a ser enviadas ao servidor.',
    });
    expect(pairingCopy('IPHONE')).toEqual(pairingCopy());
  });

  it('no Android fala do celular e da pulseira, sem citar iPhone nem Apple Watch', () => {
    const android = pairingCopy('ANDROID_PHONE');
    expect(android.titulo).toBe('Parear este celular');
    expect(android.instrucao).toBe(pairingCopy().instrucao);
    expect(android.pareadoTitulo).toBe('Aparelho pareado');
    expect(android.pareadoCorpo).toBe(
      'As leituras da sua pulseira passam a ser enviadas ao servidor.',
    );
    expect(Object.values(android).join(' ')).not.toMatch(/iPhone|Apple Watch/);
  });
});

describe('copy do Health Connect no pareamento', () => {
  it('explica o que o SWI lê e por que pede a permissão', () => {
    expect(HEALTH_CONNECT_PAIRING_COPY.explicacao).toBe(
      'O SWI lê as medições da sua pulseira pelo Health Connect, o app de saúde do Android. Para isso, ele pede permissão de leitura.',
    );
    expect(HEALTH_CONNECT_PAIRING_COPY.permitir).toBe('Permitir leitura');
  });

  it('ausente manda instalar, desatualizado manda atualizar, os dois pela Play Store', () => {
    expect(healthConnectInstallCopy('unavailable')).toEqual({
      corpo:
        'O Health Connect não está instalado neste celular. Instale pela Play Store e volte para o SWI.',
      botao: 'Instalar o Health Connect',
    });
    expect(healthConnectInstallCopy('update_required')).toEqual({
      corpo:
        'O Health Connect deste celular precisa de atualização. Atualize pela Play Store e volte para o SWI.',
      botao: 'Atualizar o Health Connect',
    });
  });

  // Sem travar: a pessoa sempre pode seguir e permitir depois.
  it('sem permissão diz o que fazer e que dá para seguir', () => {
    expect(HEALTH_CONNECT_PAIRING_COPY.semPermissao).toMatch(/ajustes do Health Connect/);
    expect(HEALTH_CONNECT_PAIRING_COPY.semPermissao).toMatch(/continuar/i);
    expect(HEALTH_CONNECT_PAIRING_COPY.tentarDeNovo).toBe('Tentar de novo');
    expect(HEALTH_CONNECT_PAIRING_COPY.abrirAjustes).toBe('Abrir os ajustes do Health Connect');
  });

  it('o resultado da primeira sincronização', () => {
    expect(HEALTH_CONNECT_PAIRING_COPY.sincronizando).toBe(
      'Procurando a pulseira no Health Connect…',
    );
    expect(bandDetectedCopy('Zepp')).toBe('Pulseira detectada: Zepp');
    expect(HEALTH_CONNECT_PAIRING_COPY.nenhumaPulseira).toBe('Nenhuma pulseira encontrada');
    expect(HEALTH_CONNECT_PAIRING_COPY.nenhumaPulseiraConselho).toMatch(/app da sua pulseira/);
    expect(HEALTH_CONNECT_PAIRING_COPY.nenhumaPulseiraConselho).toMatch(/Health Connect/);
  });

  // A rodada falhou em silêncio, ou caiu numa em voo: não há pulseira nem
  // "nenhuma pulseira" a afirmar. A frase não pode dizer que não há pulseira.
  it('sem resultado da primeira sincronização, uma frase neutra', () => {
    expect(HEALTH_CONNECT_PAIRING_COPY.semResultado).toBe(
      'A leitura do Health Connect ainda não trouxe resultado. O SWI tenta de novo sozinho.',
    );
    expect(HEALTH_CONNECT_PAIRING_COPY.semResultado).not.toMatch(/nenhuma/i);
  });
});

describe('copy da faixa de sincronização', () => {
  // O texto da faixa sai de syncBannerOf (dashboardVitalsView.ts); aqui fica
  // só o botão, que existe quando este celular lê o Health Connect.
  it('o botão pede a sincronização e diz que ela está em curso', () => {
    expect(SYNC_BANNER_COPY.sincronizar).toBe('Sincronizar agora');
    expect(SYNC_BANNER_COPY.sincronizando).toBe('Sincronizando…');
  });
});
