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
