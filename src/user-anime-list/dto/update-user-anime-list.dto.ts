import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { WatchStatus } from '@prisma/client';

export class UpdateUserAnimeListDto {
  @ApiProperty({ required: false, enum: WatchStatus })
  @IsOptional()
  @IsEnum(WatchStatus)
  status?: WatchStatus;

  @ApiProperty({ required: false, description: 'Episódios assistidos' })
  @IsOptional()
  @IsInt()
  @Min(0)
  episodesWatched?: number;

  @ApiProperty({ required: false, description: 'Nota pessoal (1-10)' })
  @IsOptional()
  @IsInt()
  @Min(0)
  score?: number;

  @ApiProperty({ required: false, description: 'Notas pessoais' })
  @IsOptional()
  @IsString()
  notes?: string;

  @ApiProperty({ required: false, description: 'Número de rewatchs' })
  @IsOptional()
  @IsInt()
  @Min(0)
  rewatchCount?: number;

  @ApiProperty({
    required: false,
    default: false,
    description: 'Lista privada',
  })
  @IsOptional()
  @IsBoolean()
  private?: boolean;

  @ApiProperty({ required: false, description: 'Data de início (ISO)' })
  @IsOptional()
  @IsString()
  startedAt?: string;

  @ApiProperty({ required: false, description: 'Data de conclusão (ISO)' })
  @IsOptional()
  @IsString()
  completedAt?: string;
}
