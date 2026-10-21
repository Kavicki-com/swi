import { syncedAgo } from '../vitals/dashboardVitalsView';
import {
  bandDetectedCopy,
  HEALTH_CONNECT_MONITORING_COPY,
  HEALTH_CONNECT_PAIRING_COPY,
  healthConnectInstallCopy,
  healthConnectMonitoringCopy,
  healthConnectOnboardingCopy,
  type HealthConnectMonitoringStatus,
  lastSyncCopy,
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

describe('copy do Monitoramento no Android', () => {
  const ESTADOS: HealthConnectMonitoringStatus[] = [
    'unknown',
    'unavailable',
    'update_required',
    'not_granted',
    'not_granted_after_request',
    'granted',
  ];

  it('cada estado tem título e corpo, e nenhum fala do Apple Watch', () => {
    for (const estado of ESTADOS) {
      const copy = healthConnectMonitoringCopy(estado);
      expect(copy.titulo).not.toBe('');
      expect(copy.corpo).not.toBe('');
      expect(`${copy.titulo} ${copy.corpo}`).not.toMatch(/iPhone|Apple Watch/);
    }
  });

  it('o estado de cada passo, com a frase exata', () => {
    expect(healthConnectMonitoringCopy('unknown')).toEqual({
      titulo: 'Conferindo o Health Connect',
      corpo:
        'O SWI está conferindo o acesso às medições da sua pulseira no Health Connect, o app de saúde do Android.',
    });
    expect(healthConnectMonitoringCopy('not_granted')).toEqual({
      titulo: 'Leitura não permitida',
      corpo:
        'O SWI lê as medições da sua pulseira pelo Health Connect, o app de saúde do Android, e precisa de permissão para isso. Toque em Permitir leitura.',
    });
    expect(healthConnectMonitoringCopy('granted')).toEqual({
      titulo: 'Leitura permitida',
      corpo:
        'O SWI lê as medições da sua pulseira pelo Health Connect, o app de saúde do Android.',
    });
  });

  // Mesmo título do pedido que não abriu: o estado é o mesmo, só o conselho
  // muda. Aqui não há Continuar, então a frase não promete seguir adiante.
  it('depois de um pedido sem permissão, o conselho é tentar de novo ou os ajustes', () => {
    const copy = healthConnectMonitoringCopy('not_granted_after_request');
    expect(copy.titulo).toBe(healthConnectMonitoringCopy('not_granted').titulo);
    expect(copy.corpo).toBe(
      'O SWI ainda não tem permissão para ler as medições da pulseira. Toque em Tentar de novo ou abra os ajustes do Health Connect e permita a leitura para o SWI.',
    );
    expect(copy.corpo).not.toMatch(/continuar/i);
  });

  // O corpo é o mesmo do pareamento: a Play Store é o caminho nos dois.
  it('ausente ou desatualizado usa o corpo da Play Store do pareamento', () => {
    expect(healthConnectMonitoringCopy('unavailable')).toEqual({
      titulo: 'Health Connect não instalado',
      corpo: healthConnectInstallCopy('unavailable').corpo,
    });
    expect(healthConnectMonitoringCopy('update_required')).toEqual({
      titulo: 'Health Connect desatualizado',
      corpo: healthConnectInstallCopy('update_required').corpo,
    });
  });

  it('o botão de redetectar e a falha dele', () => {
    expect(HEALTH_CONNECT_MONITORING_COPY.redetectar).toBe('Redetectar pulseira');
    expect(HEALTH_CONNECT_MONITORING_COPY.falhaRedetectar).toBe(
      'Não foi possível redetectar a pulseira. Tente de novo.',
    );
  });
});

// Fim do primeiro uso no Android: o relogio nao existe ali, e a copy do
// "sem suporte" diria que o aparelho nao monitora, o que e falso com a
// pulseira pelo Health Connect.
describe('copy do fim do primeiro uso no Android', () => {
  const ESTADOS: HealthConnectMonitoringStatus[] = [
    'unknown',
    'unavailable',
    'update_required',
    'not_granted',
    'not_granted_after_request',
    'granted',
  ];

  // O que o leitor sabe da pulseira: detectada (o nome do app dela), "nenhuma
  // pulseira", ou nenhum resultado ainda.
  const SEM_RESULTADO = { noBand: false, bandLabel: null };
  const NENHUMA = { noBand: true, bandLabel: null };
  const DETECTADA = { noBand: false, bandLabel: 'Mi Fitness' };
  const PULSEIRAS = [SEM_RESULTADO, NENHUMA, DETECTADA, null];

  it('nenhum estado fala do Apple Watch, diz que o aparelho nao monitora ou acusa negacao', () => {
    for (const pareado of [true, false]) {
      for (const pulseira of PULSEIRAS) {
        for (const estado of ESTADOS) {
          const copy = healthConnectOnboardingCopy(pareado, estado, pulseira);
          expect(copy.titulo).not.toBe('');
          expect(copy.corpo).not.toBe('');
          const frase = `${copy.titulo} ${copy.corpo}`;
          expect(frase).not.toMatch(/iPhone|Apple Watch/);
          expect(frase).not.toContain('não faz o monitoramento');
          expect(frase).not.toMatch(/negou|negad/i);
        }
      }
    }
  });

  // So a pulseira detectada sustenta a frase de que o SWI le as medicoes.
  it('pareado, com a leitura permitida e a pulseira detectada, tudo pronto', () => {
    expect(healthConnectOnboardingCopy(true, 'granted', DETECTADA)).toEqual({
      titulo: 'Tudo pronto',
      corpo:
        'O SWI lê as medições da sua pulseira pelo Health Connect e as envia ao servidor. Você acompanha em Configurações, Monitoramento.',
    });
  });

  // O passo do pareamento mostrou "ainda não trouxe resultado": o fim diz o
  // mesmo, com a mesma frase, e nao afirma leitura nem falta de pulseira.
  it('leitura permitida sem resultado ainda nao diz que esta tudo pronto', () => {
    for (const pulseira of [SEM_RESULTADO, null]) {
      const copy = healthConnectOnboardingCopy(true, 'granted', pulseira);
      expect(copy).toEqual({
        titulo: 'Quase lá',
        corpo:
          'A leitura do Health Connect ainda não trouxe resultado. O SWI tenta de novo sozinho. Você acompanha em Configurações, Monitoramento.',
      });
      expect(copy.corpo.startsWith(HEALTH_CONNECT_PAIRING_COPY.semResultado)).toBe(true);
      expect(copy.corpo).not.toMatch(/lê as medições/);
    }
  });

  // O passo do pareamento acabou de mostrar "Nenhuma pulseira encontrada": o
  // fim nao pode dizer que o SWI le a pulseira. Mesmo titulo do passo, porque
  // o estado e o mesmo.
  it('leitura permitida sem pulseira no Health Connect nao afirma leitura', () => {
    const copy = healthConnectOnboardingCopy(true, 'granted', NENHUMA);
    expect(copy).toEqual({
      titulo: 'Nenhuma pulseira encontrada',
      corpo:
        'Abra o app da sua pulseira, sincronize e confira nos ajustes dele se ele grava no Health Connect. O SWI procura de novo sozinho. Você acompanha em Configurações, Monitoramento.',
    });
    expect(copy.titulo).toBe(HEALTH_CONNECT_PAIRING_COPY.nenhumaPulseira);
    expect(copy.corpo).not.toMatch(/lê as medições/);
  });

  // Quem pulou o pareamento precisa saber que nada sai do aparelho, e onde
  // parear depois. Nada mais importa: sem pareamento nada e enviado.
  it('sem pareamento, aponta o caminho para parear depois', () => {
    for (const pulseira of PULSEIRAS) {
      for (const estado of ESTADOS) {
        expect(healthConnectOnboardingCopy(false, estado, pulseira)).toEqual({
          titulo: 'Celular ainda não pareado',
          corpo:
            'Sem o pareamento, as medições da sua pulseira não chegam ao servidor. Peça o código ao administrador e pareie em Configurações, Monitoramento.',
        });
      }
    }
  });

  it('pareado sem a leitura permitida, aponta Configurações', () => {
    for (const estado of ['not_granted', 'not_granted_after_request'] as const) {
      expect(healthConnectOnboardingCopy(true, estado, DETECTADA)).toEqual({
        titulo: 'Falta liberar a leitura',
        corpo:
          'O SWI ainda não consegue ler as medições da sua pulseira pelo Health Connect. Você pode resolver depois em Configurações, Monitoramento.',
      });
    }
  });

  // O conserto e a Play Store, nao a permissao. O titulo e o mesmo do
  // Monitoramento, para o mesmo estado ter o mesmo nome nas duas telas.
  it('Health Connect ausente ou desatualizado aponta a Play Store, com o titulo do Monitoramento', () => {
    expect(healthConnectOnboardingCopy(true, 'unavailable', DETECTADA)).toEqual({
      titulo: healthConnectMonitoringCopy('unavailable').titulo,
      corpo:
        'Instale o Health Connect pela Play Store. Você pode resolver depois em Configurações, Monitoramento.',
    });
    expect(healthConnectOnboardingCopy(true, 'update_required', DETECTADA)).toEqual({
      titulo: healthConnectMonitoringCopy('update_required').titulo,
      corpo:
        'Atualize o Health Connect pela Play Store. Você pode resolver depois em Configurações, Monitoramento.',
    });
  });

  it('antes da primeira conferência, não afirma nada: usa o "conferindo" do Monitoramento', () => {
    expect(healthConnectOnboardingCopy(true, 'unknown', DETECTADA)).toEqual(
      healthConnectMonitoringCopy('unknown'),
    );
  });
});

describe('lastSyncCopy', () => {
  const NOW = Date.parse('2026-10-01T15:00:00.000Z');
  const antes = (ms: number) => new Date(NOW - ms).toISOString();

  it('sem sincronização diz que ainda não houve', () => {
    expect(lastSyncCopy(null, NOW)).toBe('Ainda não houve sincronização com o Health Connect.');
  });

  // O "há N min" é o mesmo da faixa de sincronização (syncedAgo), para as
  // duas telas nunca dizerem tempos diferentes da mesma coisa.
  it('com sincronização diz há quanto tempo, nos cortes da faixa', () => {
    expect(lastSyncCopy(antes(10 * 1000), NOW)).toBe('Última sincronização agora há pouco');
    expect(lastSyncCopy(antes(5 * 60 * 1000), NOW)).toBe('Última sincronização há 5 min');
    expect(lastSyncCopy(antes(3 * 60 * 60 * 1000), NOW)).toBe('Última sincronização há 3 h');
    const ontem = antes(30 * 60 * 60 * 1000);
    expect(lastSyncCopy(ontem, NOW)).toBe(`Última sincronização ${syncedAgo(ontem, NOW)}`);
    expect(lastSyncCopy(ontem, NOW)).toMatch(/^Última sincronização em \d\d\/\d\d às /);
  });
});
