import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'

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

export class UpdateReportDto {
  @IsOptional() @IsString() title?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  @IsOptional() @IsIn(['accept', 'pending', 'canceled', 'info']) status?: string
  @IsOptional() @IsString() statusLabel?: string
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
}
