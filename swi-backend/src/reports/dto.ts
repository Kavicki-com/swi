import { ArrayMaxSize, IsArray, IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator'

export class CreateReportDto {
  @IsString() @IsNotEmpty() title!: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  // Só keys emitidas pelo presign (prefixo reports/): impede referenciar objeto
  // de outro prefixo (ex. chat/ na Fatia 4) e limita a contagem (anti-abuso).
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
}

// PATCH /reports/:id — todos opcionais; só os campos presentes são aplicados.
// Mesmas validações do create (title não-vazio quando enviado, keys só do
// prefixo reports/).
export class UpdateReportDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
}

export class CreateCommentDto {
  @IsString() @IsNotEmpty() @MaxLength(2000) text!: string
}
