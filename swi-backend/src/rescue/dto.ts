import { Transform } from 'class-transformer'
import { IsString, Length } from 'class-validator'

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value)

// O ferido vem no caminho da rota (:injuredId); aqui só o socorrista escolhido.
// O id é resolvido no serviço, que confirma empresa e papel, então basta ser
// um texto não vazio.
export class CreateRescueDto {
  @Transform(trim) @IsString() @Length(1, 64) rescuerId!: string
}
