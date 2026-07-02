import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Get('pending')
  listPending() { return this.users.listPending() }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string) { const u = await this.users.approve(id); return { id: u.id, approvalStatus: u.approvalStatus } }

  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/reject') @HttpCode(200)
  async reject(@Param('id') id: string) { const u = await this.users.reject(id); return { id: u.id, approvalStatus: u.approvalStatus } }
}
