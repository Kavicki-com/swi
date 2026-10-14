import { IsArray, IsOptional } from 'class-validator'
import type { AreaVertex } from './evacuation-area'

// Corpo de POST /evacuations. A área é opcional: sem ela, a evacuação é
// disparada sem recorte visual. A forma dos vértices é validada no service
// (normalizeEvacuationArea): o ValidationPipe global só precisa deixar a lista
// passar pela whitelist.
export class StartEvacuationDto {
  @IsOptional()
  @IsArray()
  area?: AreaVertex[]
}
