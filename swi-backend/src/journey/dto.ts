import { IsString, Matches } from 'class-validator'

export class AddTaskPhotoDto {
  @IsString()
  @Matches(/^task\/[0-9a-f-]{36}\.(jpg|png)$/, { message: 'imageKey inválida' })
  imageKey!: string
}
