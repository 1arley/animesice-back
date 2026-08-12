import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreatePostDto {
  @ApiProperty({
    description: 'Texto livre do post (máx 2000 caracteres)',
    example: 'Terminando Frieren e não esperava gostar tanto.',
  })
  @IsString()
  @IsNotEmpty({ message: 'O post não pode ser vazio.' })
  @MaxLength(2000, { message: 'O post deve ter no máximo 2000 caracteres.' })
  content!: string;

  @ApiPropertyOptional({
    description: 'ID do anime referenciado no post (opcional)',
  })
  @IsOptional()
  @IsString()
  animeId?: string;
}

export class CreatePostCommentDto {
  @ApiProperty({ description: 'Texto do comentário no post' })
  @IsString()
  @IsNotEmpty({ message: 'O comentário não pode ser vazio.' })
  @MaxLength(1000, {
    message: 'O comentário deve ter no máximo 1000 caracteres.',
  })
  content!: string;
}
