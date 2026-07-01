import { Injectable, NotFoundException } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { User } from '@prisma/client'

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) { return this.prisma.user.findUnique({ where: { email } }) }
  findById(id: string) { return this.prisma.user.findUnique({ where: { id } }) }

  async approve(id: string): Promise<User> {
    const u = await this.prisma.user.findUnique({ where: { id } })
    if (!u) throw new NotFoundException('Usuário não encontrado')
    return this.prisma.user.update({ where: { id }, data: { approvalStatus: 'APPROVED' } })
  }
}
