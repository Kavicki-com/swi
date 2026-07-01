import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common'
import { UsersService } from './users.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'

@Controller('users')
export class UsersController {
  constructor(private readonly users: UsersService) {}
  @UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN') @Post(':id/approve') @HttpCode(200)
  async approve(@Param('id') id: string) { const u = await this.users.approve(id); return { id: u.id, approvalStatus: u.approvalStatus } }
}
