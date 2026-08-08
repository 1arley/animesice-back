import {
  Controller,
  Get,
  Post,
  UseGuards,
  Req,
  Query,
  Body,
  Param,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import {
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
  ApiOperation,
} from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength } from 'class-validator';
import { UserService } from '@/user/user.service';
import { ApiGetUserMe } from '@/user/swagger/user.get.me.swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { ApiFindAllUsers } from '@/user/swagger/user.get.findAll.swagger';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

class UpdateProfileMetaDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  avatar?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  bio?: string;
}

@ApiTags('user')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UserController {
  constructor(private readonly userService: UserService) {}

  @Get()
  @ApiFindAllUsers()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
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
        name: { type: 'string' },
        role: { type: 'string' },
        avatar: { type: 'string' },
        bio: { type: 'string' },
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Erro desconhecido no servidor' })
  getProfile(@Req() req: AuthenticatedRequest) {
    return this.userService.findById(req.user.id);
  }

  @Get(':id/profile')
  @ApiOperation({ summary: 'Perfil público de um usuário' })
  @ApiResponse({ status: 200, description: 'Perfil público retornado' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  getPublicProfile(@Param('id') id: string) {
    return this.userService.getPublicProfile(id);
  }

  @Post('me/profile-meta')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Atualizar avatar e bio do usuário' })
  updateProfileMeta(
    @Req() req: AuthenticatedRequest,
    @Body() dto: UpdateProfileMetaDto,
  ) {
    return this.userService.updateProfileMeta(req.user.id, dto);
  }
}
