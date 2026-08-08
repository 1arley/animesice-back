import {
  IsString,
  IsNotEmpty,
  MaxLength,
  IsOptional,
  IsUUID,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class CreateCommentDto {
  @ApiProperty({ description: 'Conteúdo do comentário', maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;

  @ApiPropertyOptional({
    description: 'ID do anime (se comentário for de anime)',
  })
  @IsOptional()
  @IsUUID()
  animeId?: string;

  @ApiPropertyOptional({
    description: 'ID do episódio (se comentário for de episódio)',
  })
  @IsOptional()
  @IsUUID()
  episodeId?: string;

  @ApiPropertyOptional({ description: 'ID do comentário pai (para respostas)' })
  @IsOptional()
  @IsUUID()
  parentId?: string;
}

export class EditCommentDto {
  @ApiProperty({ description: 'Novo conteúdo do comentário', maxLength: 1000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  content!: string;
}
