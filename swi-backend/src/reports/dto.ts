import { ArrayMaxSize, IsArray, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Matches, Min } from 'class-validator'

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

export class CreateCommentDto {
  @IsString() @IsNotEmpty() body!: string
}

export class UpdateReportDto {
  @IsOptional() @IsString() @IsNotEmpty() title?: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  // Veredito do ciclo de revisão: só ADMIN altera (regra no service, U01).
  @IsOptional() @IsIn(['accept', 'pending', 'canceled', 'info']) status?: string
  @IsOptional() @IsString() statusLabel?: string
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeys?: string[]
  // Snapshot dos anexos que o FORM CARREGOU. Com ele o servidor distingue
  // "removi este anexo" de "nunca vi este anexo" (outra pessoa anexou depois do
  // load): preserva o que chegou em paralelo e só apaga do bucket a remoção
  // provada. Sem ele, o array substitui como sempre e nada é apagado do bucket.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png)$/, { each: true })
  imageKeysBase?: string[]
  // OCC: versão que o form carregou. Desatualizada responde 409; ausente, o
  // PATCH mantém o contrato antigo do painel (last-write-wins).
  @IsOptional() @IsInt() @Min(0) baseVersion?: number
}
