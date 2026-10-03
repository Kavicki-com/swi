import { Body, Controller, Delete, Get, Put, UseGuards } from '@nestjs/common'
import { WeatherService } from './weather.service'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { RolesGuard } from '../auth/roles.guard'
import { Roles } from '../auth/roles.decorator'
import { CurrentUser, type JwtUser } from '../auth/current-user.decorator'
import { WeatherLocationDto } from './dto'

// GET /weather segue aberto a qualquer usuário logado, agora no local da
// empresa do token. O local em si é do ADMIN da empresa: lê, grava e limpa
// (volta ao padrão do serviço).
@Controller('weather')
@UseGuards(JwtAuthGuard)
export class WeatherController {
  constructor(private readonly weather: WeatherService) {}

  @Get()
  get(@CurrentUser() user: JwtUser) {
    return this.weather.getSnapshot(user.companyId)
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Get('location')
  location(@CurrentUser() user: JwtUser) {
    return this.weather.getLocation(user.companyId)
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Put('location')
  setLocation(@CurrentUser() user: JwtUser, @Body() body: WeatherLocationDto) {
    return this.weather.setLocation(user.companyId, { lat: body.lat, lng: body.lng })
  }

  @UseGuards(RolesGuard) @Roles('ADMIN') @Delete('location')
  resetLocation(@CurrentUser() user: JwtUser) {
    return this.weather.resetLocation(user.companyId)
  }
}
