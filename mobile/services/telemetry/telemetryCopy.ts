import type { EnrollmentFailureReason, PhoneKind } from './deviceEnrollment';
import type { WatchProtocol } from '../../modules/swi-watch-control';
import type { TelemetryAvailability } from './telemetryAvailability';

// Fonte única da copy de estado do monitoramento. As duas superfícies que a
// mostram, o primeiro uso e Configurações, precisam dizer a mesma coisa: um
// título diferente para o mesmo estado faria o funcionário achar que são
// problemas diferentes.
//
// Termos vêm de CONTEXT.md. Nenhuma frase afirma que a permissão foi negada:
// o iOS não conta isso (ADR-0004).

/** Onde a copy aparece. Só a frase de ação muda entre as duas. */
export type TelemetryContext = 'primeiro-uso' | 'configuracoes';

export interface TelemetryCopy {
  readonly titulo: string;
  readonly corpo: string;
}

/** Caminho real do iOS 17 em português. */
const CAMINHO_DO_SISTEMA =
  'Se o acesso à Saúde estiver desligado, ligue em Ajustes, Saúde, Acesso a Dados e Dispositivos, SWI.';

export function telemetryCopy(
  a: TelemetryAvailability,
  contexto: TelemetryContext,
): TelemetryCopy {
  switch (a.kind) {
    case 'unsupported':
      // Não usa a palavra "indisponível": no glossário ela nomeia outro estado,
      // o que tem suporte mas não recebeu leitura, e que pede outro conselho.
      return {
        titulo: 'Este aparelho não faz o monitoramento',
        corpo: 'O monitoramento do piloto usa iPhone e Apple Watch. Neste aparelho ele não funciona.',
      };
    case 'current':
      return {
        titulo: 'Monitoramento ativo',
        corpo: 'Recebendo leituras do seu Apple Watch.',
      };
    case 'stale':
      return {
        titulo: 'Última leitura desatualizada',
        corpo:
          'A última leitura já tem algum tempo. Ela continua visível com o horário em que foi medida.',
      };
    case 'awaiting':
      return {
        titulo: 'Quase lá',
        corpo:
          'O relógio está ativo, mas ainda não recebemos uma leitura. Ajuste o Apple Watch no pulso e aguarde alguns segundos.',
      };
    default:
      return {
        titulo: 'Monitoramento indisponível',
        corpo:
          contexto === 'primeiro-uso'
            ? `Não recebemos leituras do seu Apple Watch. Você pode ativar depois em Configurações, Monitoramento. ${CAMINHO_DO_SISTEMA}`
            : `Não recebemos leituras do seu Apple Watch. Toque em Ativar monitoramento. ${CAMINHO_DO_SISTEMA}`,
      };
  }
}

/**
 * Linha de estado do envio ao backend, na tela de monitoramento. Sem
 * pareamento não é erro: o funcionário pareia com o código que o
 * administrador gera no painel, e até lá só precisa saber que nada está
 * saindo do aparelho.
 */
export function telemetryUploadCopy(paired: boolean): string {
  return paired ? 'Enviando ao servidor' : 'Aparelho não pareado';
}

/**
 * Aviso de relógio desatualizado, ou null quando não há o que avisar.
 *
 * O app do relógio vem dentro do pacote do iPhone, mas o sistema o instala no
 * ritmo dele: existe uma janela real de iPhone novo com relógio velho. Nela a
 * leitura continua chegando, pelo caminho antigo, então isto é um aviso e não
 * um erro. Antes de o relógio falar não se afirma nada: dizer que ele está
 * desatualizado sem saber seria inventar.
 */
export function watchProtocolCopy(watchProtocol: WatchProtocol | null): string | null {
  if (watchProtocol !== 'legacy') return null;
  return 'O app do relógio ainda não atualizou. Abra o SWI no Apple Watch.';
}

export interface PairingCopy {
  readonly titulo: string;
  readonly instrucao: string;
  readonly pareadoTitulo: string;
  readonly pareadoCorpo: string;
}

/**
 * Copy da tela de pareamento por aparelho. O iPhone pareia para o Apple
 * Watch; o Android pareia para a pulseira que grava no Health Connect. O
 * código e o jeito de pedir ao administrador são os mesmos nos dois.
 */
export function pairingCopy(kind: PhoneKind = 'IPHONE'): PairingCopy {
  const instrucao =
    'Peça ao administrador o código de pareamento de seis dígitos, gerado no painel, e digite abaixo. O código vale por dez minutos.';
  return kind === 'ANDROID_PHONE'
    ? {
        titulo: 'Parear este celular',
        instrucao,
        pareadoTitulo: 'Aparelho pareado',
        pareadoCorpo: 'As leituras da sua pulseira passam a ser enviadas ao servidor.',
      }
    : {
        titulo: 'Parear este iPhone',
        instrucao,
        pareadoTitulo: 'Aparelho pareado',
        pareadoCorpo: 'As leituras do seu Apple Watch passam a ser enviadas ao servidor.',
      };
}

/**
 * Passo do Health Connect, no Android, logo depois de parear. Nenhuma frase
 * trava a pessoa: sem permissão ela segue e permite depois, e o envio do
 * resto continua.
 */
export const HEALTH_CONNECT_PAIRING_COPY = {
  explicacao:
    'O SWI lê as medições da sua pulseira pelo Health Connect, o app de saúde do Android. Para isso, ele pede permissão de leitura.',
  permitir: 'Permitir leitura',
  // Vale para o pedido negado e para o que não chegou a abrir: nos dois o
  // conselho é o mesmo, e a frase não acusa a pessoa de ter negado.
  semPermissao:
    'O SWI ainda não tem permissão para ler as medições da pulseira. Toque em Tentar de novo ou abra os ajustes do Health Connect e permita a leitura para o SWI. Você também pode continuar e permitir depois.',
  tentarDeNovo: 'Tentar de novo',
  abrirAjustes: 'Abrir os ajustes do Health Connect',
  sincronizando: 'Procurando a pulseira no Health Connect…',
  nenhumaPulseira: 'Nenhuma pulseira encontrada',
  // Sem pulseira, cada rodada do leitor relê as 48 h e detecta de novo
  // (healthConnectReader.ts): não há o que a pessoa refazer aqui.
  nenhumaPulseiraConselho:
    'Abra o app da sua pulseira, sincronize e confira nos ajustes dele se ele grava no Health Connect. O SWI procura de novo sozinho.',
  // A primeira sincronização terminou sem pulseira e sem "nenhuma pulseira":
  // a rodada falhou em silêncio ou caiu numa em voo. Não se afirma nada sobre
  // a pulseira; a próxima rodada do envio tenta de novo.
  semResultado:
    'A leitura do Health Connect ainda não trouxe resultado. O SWI tenta de novo sozinho.',
} as const;

/**
 * Botão da faixa de sincronização, no Dashboard e em Minhas estatísticas. O
 * texto da faixa ("Dados até ... · sincronizado ...") sai de `syncBannerOf`
 * (dashboardVitalsView.ts), junto das outras frases sobre a leitura; aqui
 * fica só a ação, que existe quando este celular lê o Health Connect.
 */
export const SYNC_BANNER_COPY = {
  sincronizar: 'Sincronizar agora',
  // No lugar do rótulo enquanto a leitura, o envio e a releitura correm: o
  // botão desabilitado com o rótulo de sempre pareceria travado.
  sincronizando: 'Sincronizando…',
} as const;

/** Health Connect ausente ou desatualizado: o caminho é a Play Store. */
export function healthConnectInstallCopy(
  availability: 'unavailable' | 'update_required',
): { readonly corpo: string; readonly botao: string } {
  return availability === 'update_required'
    ? {
        corpo:
          'O Health Connect deste celular precisa de atualização. Atualize pela Play Store e volte para o SWI.',
        botao: 'Atualizar o Health Connect',
      }
    : {
        corpo:
          'O Health Connect não está instalado neste celular. Instale pela Play Store e volte para o SWI.',
        botao: 'Instalar o Health Connect',
      };
}

/** O nome vem de `bandLabel` do leitor: o do app da pulseira, ou o pacote. */
export function bandDetectedCopy(bandLabel: string): string {
  return `Pulseira detectada: ${bandLabel}`;
}

/**
 * Frase de cada desfecho do pareamento. As quatro recusas do backend têm
 * conselho próprio; o resto diz o que o funcionário pode fazer, sem culpar o
 * código quando o problema é outro. Só a falha de guardar a credencial muda
 * com o aparelho: no Android ela mora no SecureStore, não no chaveiro do
 * iPhone.
 */
export function pairingFailureCopy(
  reason: EnrollmentFailureReason,
  kind: PhoneKind = 'IPHONE',
): string {
  switch (reason) {
    case 'expired':
      return 'Este código expirou. Peça um novo ao administrador.';
    case 'already_used':
      return 'Este código já foi usado. Se este aparelho já está pareado, não é preciso repetir.';
    case 'invalid_code':
      return 'Código não confere. Confira os seis dígitos com o administrador.';
    case 'unsupported_device':
    case 'unsupported':
      return 'Este aparelho não pode ser pareado.';
    case 'rate_limited':
      return 'Muitas tentativas seguidas. Aguarde um minuto e tente de novo.';
    case 'network':
      return 'Sem conexão com o servidor. Verifique a internet e tente de novo.';
    case 'unauthorized':
      return 'Sua sessão expirou. Entre de novo no app para parear.';
    case 'keychain':
      return `Não foi possível guardar o pareamento neste ${
        kind === 'ANDROID_PHONE' ? 'celular' : 'iPhone'
      }. Tente de novo.`;
    default:
      return 'Não foi possível parear agora. Tente de novo em instantes.';
  }
}
