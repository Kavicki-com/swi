import { Transform } from 'class-transformer'
import {
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Max,
  MaxLength,
  Min,
  registerDecorator,
  ValidateIf,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

// Só http e https: o painel abre esse endereço, e qualquer outro esquema
// (javascript:, data:) rodaria código no navegador do administrador. Sem
// exigir domínio, porque a câmera pode estar num IP da rede da obra.
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false }
const URL_MAX = 2048
const NAME_MAX = 80

// Domínios liberados para o player embutido, lidos de CAMERA_EMBED_ALLOWED_HOSTS
// (lista separada por vírgula). Normaliza a caixa e ignora entradas vazias.
// Lista vazia ou ausente devolve conjunto vazio, que recusa todo player.
export function embedAllowedHosts(env: string | undefined = process.env.CAMERA_EMBED_ALLOWED_HOSTS): Set<string> {
  return new Set(
    (env ?? '')
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  )
}

// Uma entrada da lista casa com o host assim: "*" libera qualquer domínio;
// "*.dominio.com" libera o domínio e os subdomínios dele, separados por ponto
// (então "evildominio.com" não passa); qualquer outra entrada casa o host todo.
function hostMatches(host: string, entry: string): boolean {
  if (entry === '*') return true
  if (entry.startsWith('*.')) {
    const base = entry.slice(2)
    return host === base || host.endsWith(`.${base}`)
  }
  return host === entry
}

// O player por iframe roda dentro da página do painel, então só entra um
// endereço https cujo host case com a lista liberada. Casa o host todo: um
// sufixo como "liberado.com.br.evil.com" não passa. Lista vazia recusa tudo.
export function isEmbedUrlAllowed(value: unknown, hosts: Set<string> = embedAllowedHosts()): boolean {
  if (typeof value !== 'string') return false
  if (hosts.size === 0) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (parsed.protocol !== 'https:') return false
  const host = parsed.hostname.toLowerCase()
  return [...hosts].some((entry) => hostMatches(host, entry))
}

@ValidatorConstraint({ name: 'isAllowedEmbedUrl', async: false })
class IsAllowedEmbedUrlConstraint implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    return isEmbedUrlAllowed(value)
  }
  defaultMessage(): string {
    return 'Domínio do player não autorizado'
  }
}

function IsAllowedEmbedUrl(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      target: object.constructor,
      propertyName,
      options,
      constraints: [],
      validator: IsAllowedEmbedUrlConstraint,
    })
  }
}

export class CreateCameraDto {
  @Transform(trim) @IsString() @Length(1, NAME_MAX) name!: string
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat!: number
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng!: number
  @IsOptional() @Transform(trim) @IsUrl(URL_OPTIONS) @MaxLength(URL_MAX) url?: string | null
  // Player embutido: https de domínio liberado, separado do endereço acima.
  @IsOptional() @Transform(trim) @MaxLength(URL_MAX) @IsAllowedEmbedUrl() embedUrl?: string | null
}

// @ValidateIf e não @IsOptional em nome e coordenadas: null explícito precisa
// reprovar, porque um ponto sem nome ou sem posição não existe. Só o endereço
// e o player aceitam null, que os limpa.
export class UpdateCameraDto {
  @ValidateIf((o: UpdateCameraDto) => o.name !== undefined) @Transform(trim) @IsString() @Length(1, NAME_MAX) name?: string
  @ValidateIf((o: UpdateCameraDto) => o.lat !== undefined) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat?: number
  @ValidateIf((o: UpdateCameraDto) => o.lng !== undefined) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng?: number
  @IsOptional() @Transform(trim) @IsUrl(URL_OPTIONS) @MaxLength(URL_MAX) url?: string | null
  @IsOptional() @Transform(trim) @MaxLength(URL_MAX) @IsAllowedEmbedUrl() embedUrl?: string | null
}
