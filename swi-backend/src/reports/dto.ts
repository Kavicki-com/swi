import { ArrayMaxSize, IsArray, IsInt, IsNotEmpty, IsOptional, IsPositive, IsString, Matches, Max } from 'class-validator'
import { Type } from 'class-transformer'

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

export class ListReportsQueryDto {
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() @Max(1_000_000) page?: number
  @IsOptional() @Type(() => Number) @IsInt() @IsPositive() limit?: number
}
