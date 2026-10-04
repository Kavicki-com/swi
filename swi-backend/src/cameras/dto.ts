import { Transform } from 'class-transformer'
import { IsNumber, IsOptional, IsString, IsUrl, Length, Max, MaxLength, Min, ValidateIf } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

// Só http e https: o painel abre esse endereço, e qualquer outro esquema
// (javascript:, data:) rodaria código no navegador do administrador. Sem
// exigir domínio, porque a câmera pode estar num IP da rede da obra.
const URL_OPTIONS = { protocols: ['http', 'https'], require_protocol: true, require_tld: false }
const URL_MAX = 2048
const NAME_MAX = 80

export class CreateCameraDto {
  @Transform(trim) @IsString() @Length(1, NAME_MAX) name!: string
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat!: number
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng!: number
  @IsOptional() @Transform(trim) @IsUrl(URL_OPTIONS) @MaxLength(URL_MAX) url?: string | null
}

// @ValidateIf e não @IsOptional em nome e coordenadas: null explícito precisa
// reprovar, porque um ponto sem nome ou sem posição não existe. Só o endereço
// aceita null, que o limpa.
export class UpdateCameraDto {
  @ValidateIf((o: UpdateCameraDto) => o.name !== undefined) @Transform(trim) @IsString() @Length(1, NAME_MAX) name?: string
  @ValidateIf((o: UpdateCameraDto) => o.lat !== undefined) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat?: number
  @ValidateIf((o: UpdateCameraDto) => o.lng !== undefined) @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng?: number
  @IsOptional() @Transform(trim) @IsUrl(URL_OPTIONS) @MaxLength(URL_MAX) url?: string | null
}
