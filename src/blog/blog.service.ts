import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sanitizeHtml from 'sanitize-html';
import { PrismaService } from '@/prisma/prisma.service';
import { CreateBlogPostDto, UpdateBlogPostDto } from '@/blog/dto/blog-post.dto';

const BLOG_HTML_OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    'p',
    'br',
    'h2',
    'h3',
    'h4',
    'ul',
    'ol',
    'li',
    'strong',
    'b',
    'em',
    'i',
    'blockquote',
    'code',
    'pre',
    'a',
    'hr',
    'figure',
    'figcaption',
    'img',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height', 'loading'],
    code: ['class'],
  },
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https'] },
  allowProtocolRelative: false,
  transformTags: {
    a: (_tagName, attribs) => ({
      tagName: 'a',
      attribs: {
        ...attribs,
        ...(attribs.target === '_blank' ? { rel: 'noopener noreferrer' } : {}),
      },
    }),
    img: (_tagName, attribs) => ({
      tagName: 'img',
      attribs: { ...attribs, loading: 'lazy' },
    }),
  },
};

@Injectable()
export class BlogService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    page = 1,
    limit = 24,
    options: { canManage?: boolean; published?: boolean } = {},
  ) {
    const safePage = Math.max(page, 1);
    const safeLimit = Math.min(Math.max(limit, 1), 100);
    const published = options.canManage ? options.published : true;
    const where: Prisma.BlogPostWhereInput =
      published == null ? {} : { published };

    const [data, total] = await this.prisma.$transaction([
      this.prisma.blogPost.findMany({
        where,
        skip: (safePage - 1) * safeLimit,
        take: safeLimit,
        orderBy: [{ publishedAt: 'desc' }, { createdAt: 'desc' }],
      }),
      this.prisma.blogPost.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page: safePage,
        limit: safeLimit,
        totalPages: Math.ceil(total / safeLimit),
      },
    };
  }

  async findPublishedBySlug(slug: string) {
    const post = await this.prisma.blogPost.findFirst({
      where: { slug, published: true },
    });
    if (!post) throw new NotFoundException('Artigo não encontrado.');
    return post;
  }

  async findById(id: string) {
    const post = await this.prisma.blogPost.findUnique({ where: { id } });
    if (!post) throw new NotFoundException('Artigo não encontrado.');
    return post;
  }

  async create(dto: CreateBlogPostDto) {
    try {
      return await this.prisma.blogPost.create({
        data: this.writeData(dto) as Prisma.BlogPostCreateInput,
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async update(id: string, dto: UpdateBlogPostDto) {
    await this.findById(id);
    try {
      return await this.prisma.blogPost.update({
        where: { id },
        data: this.writeData(dto),
      });
    } catch (error) {
      this.handleWriteError(error);
    }
  }

  async remove(id: string) {
    await this.findById(id);
    await this.prisma.blogPost.delete({ where: { id } });
    return { message: 'Artigo excluído.' };
  }

  private writeData(dto: CreateBlogPostDto | UpdateBlogPostDto) {
    const data: Record<string, unknown> = { ...dto };
    if (dto.title !== undefined) data.title = dto.title.trim();
    if (dto.slug !== undefined) data.slug = dto.slug.trim();
    if (dto.description !== undefined)
      data.description = dto.description.trim();
    if (dto.category !== undefined) data.category = dto.category.trim();
    if (dto.content !== undefined) {
      data.content = sanitizeHtml(dto.content, BLOG_HTML_OPTIONS).trim();
    }
    if ('publishedAt' in dto) {
      data.publishedAt = dto.publishedAt ? new Date(dto.publishedAt) : null;
    }
    if (dto.published === true && !dto.publishedAt) {
      data.publishedAt = new Date();
    }
    return data;
  }

  private handleWriteError(error: unknown): never {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Já existe um artigo com este slug.');
    }
    throw error;
  }
}
