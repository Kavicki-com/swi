import { BadRequestException, Body, Controller, Delete, Get, HttpCode, NotFoundException, Param, Post, Put, UseGuards } from '@nestjs/common'
import { ProfileService } from './profile.service'
import { CreateExamDto, UpdateProfileDto } from './dto'
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
    return { ...p, avatarUrl, examUrls, exams: await this.examDtos(userId) }
  }

  // Histórico de exames. O card do design (ExamInfoCard) mostra nome + validade
  // + download, então cada item leva os três.
  @Get('exams')
  exams(@CurrentUserId() userId: string) {
    return this.examDtos(userId)
  }

  @Post('exams')
  async addExam(@CurrentUserId() userId: string, @Body() dto: CreateExamDto) {
    const exam = await this.profile.addExam(userId, dto)
    return {
      id: exam.id,
      name: exam.name,
      date: exam.date.toISOString().slice(0, 10),
      fileUrl: await this.media.presignGet(exam.fileKey),
    }
  }

  @Delete('exams/:id')
  @HttpCode(204)
  async removeExam(@CurrentUserId() userId: string, @Param('id') id: string) {
    // Exame de outra pessoa é invisível (404, não 403) — mesma semântica de
    // escopo do resto do backend.
    if (!(await this.profile.removeExam(userId, id))) {
      throw new NotFoundException('Exame não encontrado')
    }
  }

  private async examDtos(userId: string) {
    const rows = await this.profile.listExams(userId)
    return Promise.all(
      rows.map(async (e) => ({
        id: e.id,
        name: e.name,
        // Data de CALENDÁRIO na resposta ('AAAA-MM-DD'): mandar ISO datetime
        // faria o dia recuar um em fuso negativo na hora de formatar.
        date: e.date.toISOString().slice(0, 10),
        // Assinada na leitura, nunca persistida (expira).
        fileUrl: await this.media.presignGet(e.fileKey),
      })),
    )
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
