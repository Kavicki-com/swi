import { ApiProperty } from '@nestjs/swagger'
import { BluetoothListenerState, HealthConnectAvailability, HealthConnectFailureReason } from '@prisma/client'
import { Type } from 'class-transformer'
import { IsBoolean, IsEnum, IsISO8601, IsObject, IsOptional, IsString, Length, ValidateNested } from 'class-validator'

// Corpo de PUT /telemetry/v1/devices/me/readiness: os fatos de prontidão que só
// o celular Android conhece. Cada relato substitui o anterior inteiro, então o
// app manda sempre tudo o que sabe. Campo nulo ou ausente é "o app não sabe"
// (permissão antes da primeira rodada, por exemplo), e o backend devolve o
// passo correspondente como não informado em vez de afirmar que falta.

export class HealthConnectFailureDto {
  @ApiProperty({ enum: HealthConnectFailureReason })
  @IsEnum(HealthConnectFailureReason) reason!: HealthConnectFailureReason

  /** Quando a sincronização falhou, no relógio do celular. */
  @IsISO8601() at!: string
}

export class HealthConnectReadinessDto {
  // Os enums do Prisma escapam do plugin do Swagger, que os documentaria como objeto.
  @ApiProperty({ enum: HealthConnectAvailability, nullable: true, required: false })
  @IsOptional() @IsEnum(HealthConnectAvailability) availability?: HealthConnectAvailability | null

  /** Permissão de ler batimento, concedida ou não. */
  @IsOptional() @IsBoolean() readGranted?: boolean | null

  /** Permissão de ler em segundo plano, concedida ou não. */
  @IsOptional() @IsBoolean() backgroundGranted?: boolean | null

  /**
   * Pacote do app do fabricante que gravou no Health Connect. Só o detectado:
   * a resposta do funcionário à pergunta sobre o app fica no aparelho. Aqui
   * nulo não é "não sei", é "nenhum detectado", e o passo opcional fica pendente.
   */
  @IsOptional() @IsString() @Length(1, 255) manufacturerPackage?: string | null

  /** Início da última sincronização com sucesso. */
  @IsOptional() @IsISO8601() lastSyncAt?: string | null

  @IsOptional() @ValidateNested() @Type(() => HealthConnectFailureDto) lastFailure?: HealthConnectFailureDto | null
}

export class BluetoothReadinessDto {
  /** Há pulseira escolhida para a escuta por Bluetooth. */
  @IsOptional() @IsBoolean() bandChosen?: boolean | null

  @ApiProperty({ enum: BluetoothListenerState, nullable: true, required: false })
  @IsOptional() @IsEnum(BluetoothListenerState) listenerState?: BluetoothListenerState | null

  /** Desde quando a escuta está no estado informado, para "desconectada desde". */
  @IsOptional() @IsISO8601() listenerStateSince?: string | null

  /** Hora da última leitura de batimento recebida da pulseira. */
  @IsOptional() @IsISO8601() lastReadingAt?: string | null
}

export class ReadinessReportDto {
  @IsObject() @ValidateNested() @Type(() => HealthConnectReadinessDto) healthConnect!: HealthConnectReadinessDto

  @IsObject() @ValidateNested() @Type(() => BluetoothReadinessDto) bluetooth!: BluetoothReadinessDto
}
