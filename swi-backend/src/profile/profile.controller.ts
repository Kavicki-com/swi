import { BadRequestException, Body, Controller, Get, NotFoundException, Put, UseGuards } from '@nestjs/common'
import { ProfileService } from './profile.service'
import { UpdateProfileDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { CurrentUserId } from '../auth/current-user.decorator'

@Controller('profile')
@UseGuards(JwtAuthGuard)
export class ProfileController {
  constructor(private readonly profile: ProfileService) {}

  @Get('me')
  async me(@CurrentUserId() userId: string) {
    const p = await this.profile.getByUserId(userId)
    if (!p) throw new NotFoundException('Perfil ainda não preenchido')
    return p
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
