import { IsIn, IsOptional, IsString, MinLength } from 'class-validator'

// Payload do "Solicitar Pausa" do detalhe do funcionário. Em arquivo próprio,
// e não no controller, porque o plugin do Swagger só deriva esquema de DTO que
// mora em arquivo dto.ts (ver nest-cli.json).
export class PauseRequestDto { @IsString() @MinLength(1) workerId!: string }

// Quem lista: o painel manda surface=panel e não vê o que limpou no sino; o app
// não manda nada e continua vendo tudo.
export const NOTIFICATION_SURFACES = ['panel'] as const
export type NotificationSurface = (typeof NOTIFICATION_SURFACES)[number]

export class NotificationListQueryDto {
  @IsOptional() @IsIn(NOTIFICATION_SURFACES) surface?: NotificationSurface
}
