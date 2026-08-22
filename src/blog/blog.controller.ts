import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { Role } from '@prisma/client';
import { BlogService } from '@/blog/blog.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from '@/blog/dto/blog-post.dto';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';

type OptionalAuthRequest = Request & { user?: { role: Role } };

@ApiTags('blog')
@Controller('blog-posts')
export class BlogController {
  constructor(private readonly blogService: BlogService) {}

  @Get()
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Listar artigos; rascunhos somente para admins' })
  list(
    @Req() req: OptionalAuthRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('published') published?: string,
  ) {
    const canManage =
      req.user?.role === 'ADMIN' || req.user?.role === 'SUPERADMIN';
    return this.blogService.list(
      Number.parseInt(page ?? '1', 10) || 1,
      Number.parseInt(limit ?? '24', 10) || 24,
      {
        canManage,
        published:
          canManage && published !== undefined
            ? published === 'true'
            : undefined,
      },
    );
  }

  @Get('slug/:slug')
  @ApiOperation({ summary: 'Buscar artigo publicado pelo slug' })
  findPublishedBySlug(@Param('slug') slug: string) {
    return this.blogService.findPublishedBySlug(slug);
  }

  @Get(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Buscar artigo por ID (admin)' })
  findById(@Param('id') id: string) {
    return this.blogService.findById(id);
  }

  @Post()
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('CREATE_BLOG_POST', 'BlogPost')
  @ApiBearerAuth('JWT-auth')
  create(@Body() dto: CreateBlogPostDto) {
    return this.blogService.create(dto);
  }

  @Patch(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('UPDATE_BLOG_POST', 'BlogPost')
  @ApiBearerAuth('JWT-auth')
  update(@Param('id') id: string, @Body() dto: UpdateBlogPostDto) {
    return this.blogService.update(id, dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('DELETE_BLOG_POST', 'BlogPost')
  @ApiBearerAuth('JWT-auth')
  remove(@Param('id') id: string) {
    return this.blogService.remove(id);
  }
}
