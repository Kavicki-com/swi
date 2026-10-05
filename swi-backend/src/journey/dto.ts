import { IsOptional, IsString, Matches, MaxLength } from 'class-validator'

// Corpo das seis ações da jornada. Opcional por inteiro: o app instalado não
// manda corpo, e a ação vale na hora em que chega.
export class JourneyActionDto {
  // Hora do toque no relógio do aparelho, ISO-8601 com fuso. O formato é
  // conferido em action-time.ts, junto com a hora do envio.
  @IsOptional()
  @IsString()
  @MaxLength(40)
  occurredAt?: string | null
}

export class AddTaskPhotoDto {
  @IsString()
  @Matches(/^task\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey!: string
}
