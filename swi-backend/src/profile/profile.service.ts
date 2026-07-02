import { Injectable } from '@nestjs/common'
import { PrismaService } from '../prisma/prisma.service'
import type { Prisma, Profile } from '@prisma/client'

@Injectable()
export class ProfileService {
  constructor(private readonly prisma: PrismaService) {}

  getByUserId(userId: string): Promise<Profile | null> {
    return this.prisma.profile.findUnique({ where: { userId } })
  }

  upsert(userId: string, patch: Prisma.ProfileUpdateInput): Promise<Profile> {
    return this.prisma.profile.upsert({
      where: { userId },
      create: { userId, ...patch } as Prisma.ProfileUncheckedCreateInput,
      update: patch,
    })
  }
}
