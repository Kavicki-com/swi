import { parseSocketPingInterval } from '../config/runtime-env'

/**
 * Opções do servidor socket.io que vêm do ambiente. O Nest cria um servidor só
 * para os gateways sem namespace e usa as opções do primeiro que registrar, por
 * isso todos espalham este mesmo objeto. O valor já foi validado no boot; aqui
 * um valor inválido só deixa de virar opção.
 */
export function socketServerOptions(env: NodeJS.ProcessEnv): { pingInterval?: number } {
  const pingInterval = parseSocketPingInterval(env, [])
  return pingInterval === undefined ? {} : { pingInterval }
}
