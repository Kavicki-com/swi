import { Transform } from 'class-transformer'
import { IsIn, IsString, Matches, MaxLength } from 'class-validator'
import type { PushPlatform } from '@prisma/client'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

// Token que o expo-notifications devolve (getExpoPushTokenAsync). Os dois
// prefixos existem: o antigo ExponentPushToken e o atual ExpoPushToken. Só
// esse formato entra, porque o envio vai pelo serviço da Expo: um token cru do
// FCM ou do APNs gravado aqui nunca receberia nada. A expressão vai literal em
// cada decorator, e não numa constante, porque o plugin do Swagger copia o
// texto do argumento para o `pattern` do OpenAPI: com constante, sairia o nome.
const TOKEN_MESSAGE = 'token precisa ser um token de push da Expo (ExponentPushToken[...] ou ExpoPushToken[...])'

export const PUSH_PLATFORMS = ['android', 'ios'] as const satisfies readonly PushPlatform[]

// Em arquivo dto.ts porque o plugin do Swagger só deriva esquema daqui (ver
// nest-cli.json).
export class RegisterPushTokenDto {
  @Transform(trim) @IsString() @MaxLength(255) @Matches(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, { message: TOKEN_MESSAGE })
  token!: string

  @IsIn(PUSH_PLATFORMS) platform!: PushPlatform
}

export class RemovePushTokenDto {
  @Transform(trim) @IsString() @MaxLength(255) @Matches(/^Expo(nent)?PushToken\[[^\]\s]+\]$/, { message: TOKEN_MESSAGE })
  token!: string
}
