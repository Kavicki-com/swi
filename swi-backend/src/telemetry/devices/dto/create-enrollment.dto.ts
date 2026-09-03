import { IsIn, IsString } from 'class-validator'
import { ENROLLABLE_KINDS, type EnrollableKind } from '../device-auth.service'

/** Corpo do convite de pareamento. Quem convida vem do token, não daqui. */
export class CreateEnrollmentDto {
  // @IsString e não @IsUUID: nem todo id de User é uuid (o seed usa ids
  // legíveis). Quem confere existência e escopo de empresa é o serviço.
  @IsString() workerId!: string

  // A lista vem do serviço, que a deriva do enum do Prisma: o tipo de aparelho
  // tem uma fonte só, e o relógio fica fora dela de propósito.
  @IsIn(ENROLLABLE_KINDS) kind!: EnrollableKind
}
