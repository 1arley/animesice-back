import {
  Controller,
  Get,
  Post,
  Delete,
  UseGuards,
  UseInterceptors,
  Req,
  Query,
  Body,
  Param,
  UploadedFile,
  HttpCode,
  HttpStatus,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiTags,
  ApiBearerAuth,
  ApiResponse,
  ApiOperation,
  ApiConsumes,
  ApiBody,
} from '@nestjs/swagger';
import { IsString, IsOptional, MaxLength, Matches } from 'class-validator';
import { UserService } from '@/user/user.service';
import { ApiGetUserMe } from '@/user/swagger/user.get.me.swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';
import { ApiFindAllUsers } from '@/user/swagger/user.get.findAll.swagger';
import {
  DEFAULT_PAGE,
  DEFAULT_PAGE_SIZE,
  parsePageParam,
} from '@/common/constants';
import {
  ALLOWED_IMAGE_MIMETYPES,
  MAX_AVATAR_BYTES,
  SupabaseService,
} from '@/upload/supabase.service';
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

  @IsOptional()
  @IsString()
  @MaxLength(200)
  @Matches(/^[a-zA-Z0-9_@/.:-]*$/, {
    message: 'MyAnimeList inválido: use apenas letras, números, _ ou -.',
  })
  myAnimeList?: string;

  @IsOptional()
  @IsString()
  @Matches(/^[a-z0-9_-]{3,20}$/, {
    message:
      'Apelido deve ter entre 3 e 20 caracteres e usar apenas letras minúsculas, números, _ ou -.',
  })
  userName?: string;
}

@ApiTags('user')
@Controller('user')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth('JWT-auth')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly supabaseService: SupabaseService,
  ) {}

  @Get()
  @ApiFindAllUsers()
  @UseGuards(RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('LIST_USERS', 'User')
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

  @Post('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: { type: 'string', format: 'binary' },
      },
      required: ['file'],
    },
  })
  @ApiOperation({
    summary: 'Upload do avatar do usuário (JPG/PNG, máx 50KB)',
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_AVATAR_BYTES },
      fileFilter: (_req, file, cb) => {
        const mime = file.mimetype?.toLowerCase() ?? '';
        if (!ALLOWED_IMAGE_MIMETYPES.includes(mime)) {
          cb(
            new BadRequestException(
              'Tipo de arquivo inválido. Aceitos: JPG, PNG.',
            ),
            false,
          );
          return;
        }
        cb(null, true);
      },
    }),
  )
  async uploadAvatar(
    @Req() req: AuthenticatedRequest,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo de imagem não enviado.');
    }

    const { url } = await this.supabaseService.uploadImage(
      file.buffer,
      file.mimetype,
      file.originalname,
      req.user.id,
    );

    const current = await this.userService.findById(req.user.id);
    if (current.avatar) {
      await this.supabaseService.deleteAvatarImage(current.avatar);
    }

    return this.userService.updateProfileMeta(req.user.id, { avatar: url });
  }

  @Delete('me/avatar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Remover avatar do usuário (volta ao fallback)' })
  async deleteAvatar(@Req() req: AuthenticatedRequest) {
    const current = await this.userService.findById(req.user.id);
    if (current.avatar) {
      await this.supabaseService.deleteAvatarImage(current.avatar);
    }
    return this.userService.clearAvatar(req.user.id);
  }
}
