import { ArrayMaxSize, IsArray, IsIn, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator'

export class CreateReportDto {
  @IsString() @IsNotEmpty() title!: string
  @IsOptional() @IsString() summary?: string
  @IsOptional() @IsString() details?: string
  @IsOptional() @IsArray() @ArrayMaxSize(50) @IsString({ each: true }) responsibles?: string[]
  // Só keys emitidas pelo presign (prefixo reports/): impede referenciar objeto
  // de outro prefixo (ex. chat/ na Fatia 4) e limita a contagem (anti-abuso).
  // O nome segue `imageKeys` pra não quebrar o app instalado, mas aceita todo
  // anexo multimídia do relatório: imagem, vídeo, áudio e pdf. O regex fica
  // literal porque o plugin do Swagger publica o texto do decorator; o dto.spec
  // trava que ele aceita a key de todo tipo que o presign de reports aceita.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png|mp4|mov|mp3|m4a|wav|pdf)$/, { each: true })
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
  @IsOptional() @IsIn(['accept', 'pending', 'canceled', 'info']) status?: string
  @IsOptional() @IsString() statusLabel?: string
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png|mp4|mov|mp3|m4a|wav|pdf)$/, { each: true })
  imageKeys?: string[]
  // Snapshot dos anexos que o FORM CARREGOU. Com ele o servidor distingue
  // "removi este anexo" de "nunca vi este anexo" (outra pessoa anexou depois do
  // load): preserva o que chegou em paralelo e só apaga do bucket a remoção
  // provada. Sem ele, o array substitui como sempre e nada é apagado do bucket.
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  @Matches(/^reports\/[0-9a-f-]{36}\.(jpg|png|mp4|mov|mp3|m4a|wav|pdf)$/, { each: true })
  imageKeysBase?: string[]
}
