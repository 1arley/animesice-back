import {
  Controller,
  Get,
  Patch,
  Delete,
  Body,
  UseGuards,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { MeService } from './me.service';
import { UpdateMeDto } from './dto/update-me.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('me')
@ApiBearerAuth('JWT-auth')
@Controller('me')
@UseGuards(JwtAuthGuard)
export class MeController {
  constructor(private readonly meService: MeService) {}

  @Get()
  @ApiOperation({ summary: 'Visualizar próprio perfil (identidade completa)' })
  @ApiResponse({ status: 200, description: 'Perfil do usuário autenticado' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.meService.getProfile(req.user.id);
  }

  @Patch()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Editar dados do próprio perfil' })
  @ApiResponse({ status: 200, description: 'Perfil atualizado' })
  updateProfile(@Req() req: AuthenticatedRequest, @Body() dto: UpdateMeDto) {
    return this.meService.updateProfile(req.user.id, dto);
  }

  @Get('activity')
  @ApiOperation({ summary: 'Visualizar própria atividade e interações' })
  @ApiResponse({ status: 200, description: 'Lista de atividades do usuário' })
  getMyActivity(
    @Req() req: AuthenticatedRequest,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.meService.getMyActivity(
      req.user.id,
      parseInt(page ?? '1', 10) || 1,
      parseInt(limit ?? '20', 10) || 20,
    );
  }

  @Get('stats')
  @ApiOperation({ summary: 'Estatísticas do próprio perfil' })
  @ApiResponse({ status: 200, description: 'Estatísticas do usuário' })
  getMyStats(@Req() req: AuthenticatedRequest) {
    return this.meService.getMyStats(req.user.id);
  }

  @Get('public')
  @ApiOperation({
    summary: 'Visualizar próprio perfil como outros usuários o veem',
  })
  @ApiResponse({ status: 200, description: 'Perfil público do usuário' })
  getMyPublicView(@Req() req: AuthenticatedRequest) {
    return this.meService.getMyPublicView(req.user.id);
  }

  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Excluir própria conta' })
  @ApiResponse({ status: 200, description: 'Conta excluída' })
  deleteMe(@Req() req: AuthenticatedRequest) {
    return this.meService.deleteMe(req.user.id);
  }
}
