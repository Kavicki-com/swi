import { IsIn, IsString } from 'class-validator'

export class PresignDto {
  @IsString() @IsIn(['image/jpeg', 'image/png']) contentType!: string
}
