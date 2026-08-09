import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiBearerAuth,
  ApiBody,
  ApiConsumes,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminService } from '@/admin/admin.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { CreateAnimeDto, UpdateAnimeDto } from '@/admin/dto/update-anime.dto';
import {
  CreateEpisodeDto,
  UpdateEpisodeDto,
} from '@/admin/dto/update-episode.dto';
import { CreateGenreDto } from '@/admin/dto/create-genre.dto';
import { ImportAnimeDto } from '@/admin/dto/import-anime.dto';
import { SupabaseService } from '@/upload/supabase.service';

const ALLOWED_VIDEO_MIMETYPES = [
  'video/mp4',
  'video/mp2t',
  'application/vnd.apple.mpegurl',
  'application/x-mpegURL',
];

/** Teto de tamanho de upload (500MB). */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024;

/** Valida o arquivo por mimetype exato + magic bytes (não confia no cliente). */
function isAllowedVideoFile(buffer: Buffer, mimetype: string): boolean {
  if (!ALLOWED_VIDEO_MIMETYPES.includes(mimetype)) return false;

  if (mimetype === 'video/mp4') {
    return buffer.length > 8 && buffer.toString('latin1', 4, 8) === 'ftyp';
  }
  if (mimetype === 'video/mp2t') {
    return buffer.length > 0 && buffer[0] === 0x47;
  }
  const head = buffer.subarray(0, 1024).toString('latin1');
  return head.includes('#EXTM3U');
}

@ApiTags('admin')
@ApiBearerAuth('JWT-auth')
@Controller('admin')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('ADMIN', 'SUPERADMIN')
export class AdminController {
  constructor(
    private readonly adminService: AdminService,
    private readonly supabaseService: SupabaseService,
  ) {}

  // --- Overview -----------------------------------------------------------
  @Get('animes')
  @ApiOperation({ summary: 'Listar animes (admin, com contagem de episódios)' })
  listAnimes(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search?: string,
  ) {
    const pageNumber = Math.max(parseInt(page || '1', 10) || 1, 1);
    const limitNumber = Math.min(
      Math.max(parseInt(limit || '50', 10) || 50, 1),
      200,
    );
    return this.adminService.listAnimesForAdmin(
      pageNumber,
      limitNumber,
      search?.trim() || undefined,
    );
  }

  // --- Anime CRUD ---------------------------------------------------------
  @Post('anime')
  @ApiOperation({ summary: 'Criar anime' })
  createAnime(@Body() dto: CreateAnimeDto) {
    return this.adminService.createAnime(dto);
  }

  @Post('anime/import')
  @ApiOperation({ summary: 'Importar anime via AniList (por id ou busca)' })
  importAnime(@Body() dto: ImportAnimeDto) {
    return this.adminService.importFromAniList(dto);
  }

  @Patch('anime/:slug')
  @ApiOperation({ summary: 'Atualizar anime por slug' })
  updateAnime(@Param('slug') slug: string, @Body() dto: UpdateAnimeDto) {
    return this.adminService.updateAnime(slug, dto);
  }

  @Delete('anime/:slug')
  @ApiOperation({ summary: 'Remover anime por slug' })
  deleteAnime(@Param('slug') slug: string) {
    return this.adminService.deleteAnime(slug);
  }

  // --- Episode CRUD -------------------------------------------------------
  @Post('episode/:slug')
  @ApiOperation({ summary: 'Criar episódio para um anime' })
  createEpisode(@Param('slug') slug: string, @Body() dto: CreateEpisodeDto) {
    return this.adminService.createEpisode(slug, dto);
  }

  @Patch('episode/:slug/:number')
  @ApiOperation({ summary: 'Atualizar episódio (ex: cadastrar videoUrl)' })
  updateEpisode(
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
    @Body() dto: UpdateEpisodeDto,
  ) {
    return this.adminService.updateEpisode(slug, number, dto);
  }

  @Post('episode/:slug/:number/upload')
  @ApiOperation({
    summary: 'Upload de vídeo (.mp4/.m3u8/.ts) p/ Supabase Storage',
  })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        file: {
          type: 'string',
          format: 'binary',
        },
      },
      required: ['file'],
    },
  })
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: MAX_UPLOAD_BYTES },
    }),
  )
  async uploadEpisodeVideo(
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
    @UploadedFile() file: Express.Multer.File,
  ) {
    if (!file) {
      throw new BadRequestException('Arquivo de vídeo não enviado.');
    }

    const mimetype = file.mimetype?.toLowerCase() ?? '';
    if (!isAllowedVideoFile(file.buffer, mimetype)) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Aceitos: .mp4, .m3u8, .ts (video/mp4, video/mp2t, application/vnd.apple.mpegurl, application/x-mpegURL).',
      );
    }

    const { url } = await this.supabaseService.uploadVideo(
      file.buffer,
      file.mimetype,
      file.originalname,
    );

    return this.adminService.updateEpisode(slug, number, {
      videoUrl: url,
    });
  }

  @Delete('episode/:slug/:number')
  @ApiOperation({ summary: 'Remover episódio' })
  deleteEpisode(
    @Param('slug') slug: string,
    @Param('number', ParseIntPipe) number: number,
  ) {
    return this.adminService.deleteEpisode(slug, number);
  }

  // --- Genre --------------------------------------------------------------
  @Post('genre')
  @ApiOperation({ summary: 'Criar gênero' })
  createGenre(@Body() dto: CreateGenreDto) {
    return this.adminService.createGenre(dto);
  }
}
