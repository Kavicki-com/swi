import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common'
import { WorkOrdersService } from './work-orders.service'
import { CreateWorkOrderDto, ListWorkOrdersQueryDto, UpdateWorkOrderDto } from './dto'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUserId } from '../auth/current-user.decorator'

@Controller('work-orders')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN')
export class WorkOrdersController {
  constructor(private readonly workOrders: WorkOrdersService) {}

  @Post()
  create(@CurrentUserId() adminId: string, @Body() dto: CreateWorkOrderDto) {
    return this.workOrders.create(adminId, dto)
  }

  @Get()
  list(@Query() query: ListWorkOrdersQueryDto) {
    return this.workOrders.list(query.status)
  }

  // Declarado ANTES de :id — senão o Nest casaria "assignable" como um :id.
  @Get('assignable')
  listAssignable() {
    return this.workOrders.listAssignable()
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.workOrders.get(id)
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWorkOrderDto) {
    return this.workOrders.update(id, dto)
  }
}
