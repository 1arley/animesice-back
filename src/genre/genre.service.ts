import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '@/prisma/prisma.service';

@Injectable()
export class GenreService {
  constructor(private readonly prisma: PrismaService) {}

  async findAll() {
    return this.prisma.genre.findMany({ orderBy: { name: 'asc' } });
  }

  async findBySlug(slug: string) {
    const genre = await this.prisma.genre.findUnique({
      where: { slug },
      include: { animes: true },
    });

    if (!genre) {
      throw new NotFoundException('Gênero não encontrado.');
    }

    return genre;
  }
}
