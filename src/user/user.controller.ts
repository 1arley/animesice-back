import {
  Controller,
  Get,
  UseGuards,
  Req,
  Query,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiResponse } from '@nestjs/swagger';
import { UserService } from '@/user/user.service';
import { ApiGetUserMe } from '@/user/swagger/user.get.me.swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { ApiFindAllUsers } from '@/user/swagger/user.get.findAll.swagger';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('user')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiFindAllUsers()
  findAll(@Query('page') page: string, @Query('limit') limit: string) {
    const pageNumber = parsePageParam(page, DEFAULT_PAGE);
    const limitNumber = parsePageParam(limit, DEFAULT_PAGE_SIZE);

    return this.userService.findAll(pageNumber, limitNumber);
  }

  @Get('me')
  @ApiGetUserMe()
  @HttpCode(HttpStatus.OK)
  @ApiBearerAuth('JWT-auth')
  @ApiResponse({
    status: 200,
    description: 'Perfil do usuário obtido com sucesso',
    schema: {
      type: 'object',
      properties: {
        id: { type: 'string' },
        email: { type: 'string' },
        role: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.userService.findById(req.user.id);
  }
}
