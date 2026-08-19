import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { WorkOrdersService } from './work-orders.service'
import { CreateWorkOrderDto, ListWorkOrdersQueryDto, UpdateWorkOrderDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'

@Controller('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  create(@CurrentUser() user: JwtUser, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(user.userId, dto, user.companyId)
  }

  @Get()
  list(@Query() query: ListWorkOrdersQueryDto, @CurrentUser() user: JwtUser) {
    return this.workOrders.list(query.status, user.companyId)
  }

  // Declarado ANTES de :id — senão o Nest casaria "assignable" como um :id.
  @Get('assignable')
  listAssignable(@CurrentUser() user: JwtUser) {
    return this.workOrders.listAssignable(user.companyId)
  }

  @Get(':id')
  get(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workOrders.get(id, user.companyId)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto, @CurrentUser() user: JwtUser) {
    return this.workOrders.update(id, dto, user.companyId)
  }

  // Exclusão (204). Itens do checklist caem por cascade; o ponteiro da jornada
  // é limpo na mesma transação, no serviço.
  @Delete(':id') @HttpCode(204)
  remove(@Param('id') id: string, @CurrentUser() user: JwtUser) {
    return this.workOrders.remove(id, user.companyId)
  }
}
