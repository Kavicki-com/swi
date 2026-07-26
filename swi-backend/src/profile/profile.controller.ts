import { BadRequestException, Body, Controller, Get, NotFoundException, Put, UseGuards } from '@nestjs/common'
import { ProfileService } from './profile.service'
import { UpdateProfileDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'
import { MediaService } from '../media/media.service'

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService, private readonly media: MediaService) {}

  // Devolve as keys cruas (o form mescla exames novos sobre elas) + URLs de
  // view presignadas (padrão house: reports/users/chat presignam no read).
  @Get('me')
  async me(@CurrentUserId() userId: string) {
    const p = await this.profile.getByUserId(userId)
    if (!p) throw new NotFoundException('Perfil ainda não preenchido')
    const avatarUrl = p.avatarKey ? await this.media.presignGet(p.avatarKey) : null
    const examUrls = await this.media.presignGetMany(p.examKeys ?? [])
    return { ...p, avatarUrl, examUrls }
  }

  // Vocabulário real da org (DISTINCT de jobTitle/sector/duty) pros selects
  // do settings e do form de tarefas — ver ProfileService.catalog.
  @Get('catalog')
  catalog(@CurrentUserId() userId: string) {
    return this.profile.catalog(userId)
  }

  @Put('me')
  update(@CurrentUserId() userId: string, @Body() dto: UpdateProfileDto) {
    const data = { ...dto, ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}) }
    // Rede secundária: se o ValidationPipe for bypassado, garante que nenhum Invalid Date chegue no Prisma.
    if (data.birthDate instanceof Date && Number.isNaN(data.birthDate.getTime())) {
      throw new BadRequestException('birthDate inválido')
    }
    return this.profile.upsert(userId, data)
  }
}
