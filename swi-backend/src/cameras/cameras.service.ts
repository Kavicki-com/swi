import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common'
import { Prisma } from '@prisma/client'
import { PrismaService } from '../prisma/prisma.service'
import type { CreateCameraDto, UpdateCameraDto } from './dto'

// O endereço da câmera pode carregar acesso ao sistema do cliente, então só o
// administrador o recebe. O funcionário vê o ponto no mapa e o nome.
const adminSelect = { id: true, name: true, lat: true, lng: true, url: true, createdAt: true, updatedAt: true } as const
const pointSelect = { id: true, name: true, lat: true, lng: true } as const

@Injectable()
export class CamerasService {
  constructor(private readonly prisma: PrismaService) {}

  async list(companyId: string | null, role: string) {
    if (!companyId) return []
    return this.prisma.camera.findMany({
      where: { companyId },
      select: role === 'ADMIN' ? adminSelect : pointSelect,
      orderBy: { name: 'asc' },
    })
  }

  async create(companyId: string | null, dto: CreateCameraDto) {
    const id = this.requireCompany(companyId)
    try {
      return await this.prisma.camera.create({
        data: { companyId: id, name: dto.name, lat: dto.lat, lng: dto.lng, url: dto.url ?? null },
        select: adminSelect,
      })
    } catch (e) {
      throw this.translate(e)
    }
  }

  // updateMany filtra pela empresa na própria escrita: câmera de outra empresa
  // não é alterada nem revelada (404, não 403).
  async update(id: string, companyId: string | null, dto: UpdateCameraDto) {
    const company = this.requireCompany(companyId)
    const data: Prisma.CameraUpdateManyMutationInput = {}
    if (dto.name !== undefined) data.name = dto.name
    if (dto.lat !== undefined) data.lat = dto.lat
    if (dto.lng !== undefined) data.lng = dto.lng
    if (dto.url !== undefined) data.url = dto.url
    let count: number
    try {
      ;({ count } = await this.prisma.camera.updateMany({ where: { id, companyId: company }, data }))
    } catch (e) {
      throw this.translate(e)
    }
    if (count === 0) throw new NotFoundException('Câmera não encontrada')
    const camera = await this.prisma.camera.findUnique({ where: { id }, select: adminSelect })
    if (!camera) throw new NotFoundException('Câmera não encontrada')
    return camera
  }

  async remove(id: string, companyId: string | null): Promise<void> {
    const company = this.requireCompany(companyId)
    const { count } = await this.prisma.camera.deleteMany({ where: { id, companyId: company } })
    if (count === 0) throw new NotFoundException('Câmera não encontrada')
  }

  // A câmera é da empresa: administrador sem empresa não tem onde cadastrar.
  private requireCompany(companyId: string | null): string {
    if (!companyId) throw new ForbiddenException('Usuário sem empresa vinculada')
    return companyId
  }

  private translate(e: unknown): unknown {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
      return new ConflictException('Já existe uma câmera com esse nome')
    }
    return e
  }
}
