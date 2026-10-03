import { IsNumber, Max, Min } from 'class-validator'

// Local da obra informado pelo administrador. Número de verdade, nunca texto:
// uma coordenada que chega como string é erro de quem chama, não algo a
// converter em silêncio.
export class WeatherLocationDto {
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-90) @Max(90) lat!: number
  @IsNumber({ allowNaN: false, allowInfinity: false }) @Min(-180) @Max(180) lng!: number
}
