import { IsString, MinLength } from 'class-validator'

// Payload do "Solicitar Pausa" do detalhe do funcionário. Em arquivo próprio,
// e não no controller, porque o plugin do Swagger só deriva esquema de DTO que
// mora em arquivo dto.ts (ver nest-cli.json).
export class PauseRequestDto { @IsString() @MinLength(1) workerId!: string }
