import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import { MediaService } from '../media/media.service'
import { hash } from '../auth/codes'
import { Prisma, Role } from '@prisma/client'
import type { ApprovalStatus, Company, Exam, Profile, User } from '@prisma/client'
import type { UpdateUserDto } from './dto'

type UserWithProfile = User & { profile: Profile | null }
// exams OBRIGATÓRIO. O Prisma não tipa relação incluída como opcional: o
// findUnique do getOne já devolve `exams: Exam[]` garantido, então declarar `?`
// aqui só afrouxaria o que o compilador já dava de graça. E o fallback `?? []`
// que isso permitiria é pior que o crash: "Nenhum exame registrado" para quem
// TEM exame parece uma tela normal até alguém liberar um trabalhador para área
// de risco confiando nela. É a mesma família das alergias fixas, do tipo
// sanguíneo com default universal e dos vitais "excelentes" por padrão: falha
// silenciosamente plausível. Um 500 aparece no log e no monitoramento; um
// histórico clínico vazio por engano não aparece em lugar nenhum. Obrigatório
// também faz um segundo call site que esqueça o include falhar na COMPILAÇÃO.
type UserWithProfileCompany = UserWithProfile & { company: Company | null; exams: Exam[] }

const LIST_CAP = 200

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: MediaService,
  ) {}

  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }) }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }

  // Cadastro pelo painel: o admin define a senha e o usuário nasce pronto pra
  // logar (APPROVED + emailVerified), sem código de confirmação. Herda a empresa
  // do admin logado (null se ele não tiver). Reusa o hash bcrypt do módulo auth.
  // Os dados de saúde declaratórios persistem já na criação: o formulário os
  // renderiza, e sem colunas de destino o que a pessoa digitava era descartado.
  async create(
    adminId: string,
    dto: {
      name: string; email: string; password: string; role: Role; phone?: string; cpf?: string; birthDate?: string
      gender?: string; bloodType?: string; allergies?: string; chronicConditions?: string
    },
  ) {
    const exists = await this.findByEmail(dto.email)
    if (exists) throw new ConflictException('E-mail já cadastrado')
    const admin = await this.prisma.user.findUnique({ where: { id: adminId }, select: { companyId: true } })
    try {
      const user = await this.prisma.user.create({
        data: {
          name: dto.name,
          email: dto.email,
          passwordHash: await hash(dto.password),
          role: dto.role,
          approvalStatus: 'APPROVED',
          emailVerified: true,
          companyId: admin?.companyId ?? null,
          profile: {
            create: {
              fullName: dto.name,
              ...(dto.phone ? { phone: dto.phone } : {}),
              ...(dto.cpf ? { cpf: dto.cpf } : {}),
              ...(dto.birthDate ? { birthDate: new Date(dto.birthDate) } : {}),
              ...(dto.gender ? { gender: dto.gender } : {}),
              ...(dto.bloodType ? { bloodType: dto.bloodType } : {}),
              ...(dto.allergies ? { allergies: dto.allergies } : {}),
              ...(dto.chronicConditions ? { chronicConditions: dto.chronicConditions } : {}),
            },
          },
        },
        include: { profile: true },
      })
      return this.toSummaryDto(user)
    } catch (e) {
      // Rede de segurança pra corrida: se dois creates concorrentes passarem o
      // pré-check, o segundo bate no unique de email (P2002) → traduz pra 409.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('E-mail já cadastrado')
      }
      throw e
    }
  }

  // Escopo por empresa: alvo fora da empresa do requisitante responde NotFound,
  // para não vazar nem a existência do usuário. companyId null é o balde
  // legado, onde usuários sem empresa só se enxergam entre si.
  private async requireSameCompany(id: string, companyId: string | null) {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u || u.companyId !== companyId) throw new NotFoundException('Usuário não encontrado')
    return u
  }

  async approve(id: string, companyId: string | null): Promise<User> {
    await this.requireSameCompany(id, companyId)
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'APPROVED' } })
  }

  // A fila devolvia só id/email/nome/data: o admin aprovava sem ver CPF,
  // contato ou tipo sanguíneo — decisão às cegas numa ferramenta de segurança
  // do trabalho. Agora que o app manda o perfil JUNTO do cadastro (ver
  // SignupProfileDto), a fila mostra o que o worker preencheu.
  async listPending(companyId: string | null) {
    const rows = await this.prisma.user.findMany({
      where: { approvalStatus: 'PENDING', companyId },
      select: {
        id: true,
        email: true,
        name: true,
        createdAt: true,
        profile: {
          select: {
            cpf: true, phone: true, birthDate: true,
            city: true, uf: true,
            bloodType: true, allergies: true,
            avatarKey: true,
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    })
    return Promise.all(
      rows.map(async (u) => ({
        id: u.id,
        email: u.email,
        name: u.name,
        createdAt: u.createdAt,
        // '' e null viram null: a tela decide o texto de "não informado" — o
        // backend não inventa placeholder.
        cpf: u.profile?.cpf || null,
        phone: u.profile?.phone || null,
        birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
        city: u.profile?.city || null,
        uf: u.profile?.uf || null,
        bloodType: u.profile?.bloodType || null,
        allergies: u.profile?.allergies || null,
        avatar: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
      })),
    )
  }

  async reject(id: string, companyId: string | null): Promise<User> {
    await this.requireSameCompany(id, companyId)
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'REJECTED' } })
  }

  // Lista o diretório do painel (Colaboradores = role WORKER, Admins = role
  // ADMIN). Filtros opcionais; sem filtro devolve todos. Só campos de identidade
  // — vitais/saúde ficam por conta da smartband (mock no front até o hardware).
  async list(companyId: string | null, role?: Role, approvalStatus?: ApprovalStatus) {
    if (role !== undefined && !(role in Role)) throw new BadRequestException('role inválido')
    const users = await this.prisma.user.findMany({
      where: {
        companyId,
        ...(role !== undefined ? { role } : {}),
        ...(approvalStatus !== undefined ? { approvalStatus } : {}),
      },
      include: { profile: true },
      orderBy: { name: 'asc' },
      take: LIST_CAP,
    })
    return Promise.all(users.map((u) => this.toSummaryDto(u)))
  }

  /**
   * Patch de cadastro pelo painel: identidade no User e dados declaratórios no
   * Profile, além do `active` que a rota já aceitava. Antes disto o PATCH só
   * entendia `{ active }`, então não havia como editar um funcionário nem um
   * administrador, e o que a pessoa digitava nos "Dados de saúde" do cadastro
   * era descartado no submit.
   *
   * Perfil vai por UPSERT: quem nunca preencheu nada não tem linha em Profile,
   * e um update puro estouraria P2025 logo no primeiro save.
   *
   * `fullName` acompanha `name` porque o Profile é a fonte canônica de exibição
   * (os snapshots denorm de Report e o diretório do chat leem dele); deixar os
   * dois divergirem faria a tela mostrar um nome e o card de outro.
   */
  async update(id: string, dto: UpdateUserDto, requesterId: string, companyId: string | null) {
    // Mesma guarda do setActive: o admin não pode se auto-trancar (reativar a
    // si mesmo segue permitido).
    if (id === requesterId && dto.active === false) throw new BadRequestException('Não é possível desativar a si mesmo')
    await this.requireSameCompany(id, companyId)

    const profile: Prisma.ProfileUpdateWithoutUserInput = {}
    if (dto.name !== undefined) profile.fullName = dto.name
    if (dto.phone !== undefined) profile.phone = dto.phone
    if (dto.cpf !== undefined) profile.cpf = dto.cpf
    // Truthy de propósito (paridade com o PUT /profile/me): null aqui é
    // IGNORADO, nunca convertido, porque new Date(null) fabrica 1970-01-01.
    if (dto.birthDate) profile.birthDate = new Date(dto.birthDate)
    if (dto.cep !== undefined) profile.cep = dto.cep
    if (dto.street !== undefined) profile.street = dto.street
    if (dto.number !== undefined) profile.number = dto.number
    if (dto.complement !== undefined) profile.complement = dto.complement
    if (dto.neighborhood !== undefined) profile.neighborhood = dto.neighborhood
    if (dto.city !== undefined) profile.city = dto.city
    if (dto.uf !== undefined) profile.uf = dto.uf
    if (dto.sector !== undefined) profile.sector = dto.sector
    if (dto.jobTitle !== undefined) profile.jobTitle = dto.jobTitle
    if (dto.duty !== undefined) profile.duty = dto.duty
    if (dto.gender !== undefined) profile.gender = dto.gender
    if (dto.bloodType !== undefined) profile.bloodType = dto.bloodType
    if (dto.allergies !== undefined) profile.allergies = dto.allergies
    if (dto.chronicConditions !== undefined) profile.chronicConditions = dto.chronicConditions
    if (dto.managerName !== undefined) profile.managerName = dto.managerName
    if (dto.heightCm !== undefined) profile.heightCm = dto.heightCm
    if (dto.weightKg !== undefined) profile.weightKg = dto.weightKg
    if (dto.hasDisability !== undefined) profile.hasDisability = dto.hasDisability
    const tocaPerfil = Object.keys(profile).length > 0

    try {
      const u = await this.prisma.user.update({
        where: { id },
        data: {
          ...(dto.active !== undefined ? { active: dto.active } : {}),
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          // Sem campo de perfil no corpo, nada de `profile` no data: um upsert
          // vazio criaria linha de Profile em quem só teve o active alternado.
          ...(tocaPerfil
            ? { profile: { upsert: { create: profile as Prisma.ProfileCreateWithoutUserInput, update: profile } } }
            : {}),
        },
        include: { profile: true },
      })
      return this.toSummaryDto(u)
    } catch (e) {
      // sem exception filter global: sem isto, P2025 (id sumiu no meio) vira 500.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') throw new NotFoundException('Usuário não encontrado')
      throw e
    }
  }

  // Exclusão dura: apaga o Profile (1:1) e o User na mesma transação. Guardas:
  // não deixa o admin excluir a si mesmo; se o User tiver registros vinculados
  // por FK (P2003, ex.: reports/journeys) orienta a desativar em vez de excluir.
  async remove(id: string, requesterId: string, companyId: string | null) {
    if (id === requesterId) throw new BadRequestException('Não é possível excluir a si mesmo')
    await this.requireSameCompany(id, companyId)
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.profile.deleteMany({ where: { userId: id } })
        await tx.user.delete({ where: { id } })
      })
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2025') throw new NotFoundException('Usuário não encontrado')
        if (e.code === 'P2003') throw new ConflictException('Usuário possui registros vinculados; desative-o em vez de excluir')
      }
      throw e
    }
  }

  async getOne(id: string, companyId: string | null) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      // Ordem igual à do ProfileService.listExams (validade mais distante
      // primeiro): app e painel lendo o MESMO histórico não podem divergir.
      include: { profile: true, company: true, exams: { orderBy: { date: 'desc' } } },
    })
    if (!user || user.companyId !== companyId) throw new NotFoundException('Usuário não encontrado')
    return this.toDetailDto(user)
  }

  /**
   * Exame anexado PELO ADMIN ao cadastro de outra pessoa. O POST /profile/exams
   * grava sempre no usuário da sessão, então o admin cadastrando alguém não
   * tinha rota nenhuma pra anexar o laudo dessa pessoa: a seção de exames do
   * formulário aceitava o arquivo e não o mandava a lugar nenhum.
   *
   * Escopo pela empresa do requisitante como o resto do módulo, e por isso
   * NotFound e não Forbidden quando o alvo é de outra empresa: negar existência
   * é o que impede descobrir quem é cliente sondando ids.
   */
  async addExam(id: string, dto: { name: string; date: string; fileKey: string }, companyId: string | null) {
    await this.requireSameCompany(id, companyId)
    const exam = await this.prisma.exam.create({
      // `new Date` porque a coluna é @db.Date: a validade é data de calendário,
      // igual ao ProfileService.addExam, que escreve na MESMA tabela.
      data: { userId: id, name: dto.name, date: new Date(dto.date), fileKey: dto.fileKey },
    })
    return this.toExamDto(exam)
  }

  // Identidade + display (fullName ↔ name fallback, jobTitle/sector vazios quando
  // sem profile). birthDate em ISO (paridade com o Profile cru do wire, igual ao
  // toWorkerDto de work-orders); avatar assinado ('' sem key).
  private async toSummaryDto(u: UserWithProfile) {
    return {
      id: u.id,
      name: u.profile?.fullName ?? u.name,
      email: u.email,
      role: u.role,
      approvalStatus: u.approvalStatus,
      active: u.active,
      jobTitle: u.profile?.jobTitle ?? '',
      sector: u.profile?.sector ?? '',
      // Tipo sanguíneo REAL do Profile, que o worker ou o admin edita no
      // settings. null quando não preenchido, NUNCA um default universal.
      bloodType: u.profile?.bloodType ?? null,
      birthDate: u.profile?.birthDate ? u.profile.birthDate.toISOString() : null,
      avatar: u.profile?.avatarKey ? await this.media.presignGet(u.profile.avatarKey) : '',
      companyRole: u.companyRole,
      createdAt: u.createdAt.toISOString(),
    }
  }

  private async toDetailDto(u: UserWithProfileCompany) {
    const summary = await this.toSummaryDto(u)
    return {
      ...summary,
      phone: u.profile?.phone ?? null,
      cpf: u.profile?.cpf ?? null,
      company: u.company ? { id: u.company.id, name: u.company.name } : null,
      // Cadastro clínico declaratório, preenchido pelo worker no settings. O
      // detalhe do painel tem UI pra isso e precisa receber os campos, senão
      // "Gênero" cai num default fixo igual pra todo mundo e "Alergias"
      // renderiza um título sem conteúdo.
      gender: u.profile?.gender ?? null,
      allergies: u.profile?.allergies ?? null,
      chronicConditions: u.profile?.chronicConditions ?? null,
      // Histórico clínico REAL do worker. O detalhe do painel já tinha a UI
      // (ExamInfoCard) mas o DTO nunca trouxe os exames, então a seção ficava
      // vazia para todo mundo. Data de CALENDÁRIO ('AAAA-MM-DD'): mandar ISO
      // datetime faria o dia recuar um em fuso negativo na formatação.
      exams: await Promise.all(u.exams.map((e) => this.toExamDto(e))),
    }
  }

  // Um exame como as telas o leem. Extraído porque o detalhe e o anexo do admin
  // devolvem a MESMA coisa, e duas cópias divergiriam no primeiro ajuste feito
  // de um lado só (a data fatiada e a URL assinada são justamente o que muda).
  private async toExamDto(e: Exam) {
    return {
      id: e.id,
      name: e.name,
      date: e.date.toISOString().slice(0, 10),
      fileUrl: await this.media.presignGet(e.fileKey),
    }
  }
}
