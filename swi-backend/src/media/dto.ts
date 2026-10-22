import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
} from 'class-validator'
import { Type } from 'class-transformer'
import { MAX_ANY_UPLOAD_BYTES, maxBytesFor } from './allowed-content-types'

// O teto do tamanho depende do tipo (vídeo 100 MB, áudio 25 MB, o resto 15 MB),
// então o @Max sozinho não basta: ele só conhece um número. Este decorator cruza
// o contentLength com o contentType do mesmo corpo.
function IsWithinTypeLimit(options?: ValidationOptions) {
  return (object: object, propertyName: string) => {
    registerDecorator({
      name: 'isWithinTypeLimit',
      target: object.constructor,
      propertyName,
      options,
      validator: {
        validate(value: unknown, args: ValidationArguments) {
          const contentType = (args.object as { contentType?: unknown }).contentType
          if (typeof value !== 'number' || typeof contentType !== 'string') return true // outros decorators acusam
          return value <= maxBytesFor(contentType)
        },
        defaultMessage(args: ValidationArguments) {
          const contentType = (args.object as { contentType?: unknown }).contentType
          const max = maxBytesFor(typeof contentType === 'string' ? contentType : '')
          return `contentLength acima do teto do tipo: esperado de 1 a ${max} bytes`
        },
      },
    })
  }
}

export class PresignDto {
  // Sem @IsIn aqui: o tipo permitido DEPENDE do prefix (ver allowed-content-types).
  // O presignPut valida e devolve 400 com a lista certa.
  @IsString() contentType!: string
  // Tamanho exato do arquivo, obrigatório porque o upload é PUT presignado (o
  // R2 não faz presigned POST) e o valor entra na assinatura: o upload só passa
  // se o corpo tiver exatamente estes bytes. O @Max é o maior teto de qualquer
  // tipo (o do vídeo) e o IsWithinTypeLimit aplica o teto do tipo enviado.
  // Validar aqui devolve 400 legível em vez de um 403 opaco do storage depois
  // de subir o arquivo inteiro.
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_ANY_UPLOAD_BYTES)
  @IsWithinTypeLimit()
  contentLength!: number
  // Prefixo do objeto no bucket; restrito aos domínios que sobem mídia.
  // Default 'reports' (aceita vídeo, áudio e pdf além de imagem). 'task' são
  // fotos de tarefa, 'chat' são imagens de mensagem, e 'order' são anexos do
  // WorkOrder, que o painel sobe.
  // 'exams' e 'avatars' são exames clínicos e foto de perfil, upload do próprio
  // usuário e liberado a qualquer autenticado. Só 'order' é restrito: exige
  // workOrders.operate (ADMIN e SUPERVISOR).
  @IsOptional() @IsString() @IsIn(['reports', 'task', 'chat', 'order', 'exams', 'avatars']) prefix?: string
}
