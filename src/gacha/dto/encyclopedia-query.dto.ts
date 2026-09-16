import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { GACHA_TIERS } from '@/gacha/gacha.constants';

export class EncyclopediaQueryDto {
  @IsIn(['cards', 'sets'])
  view: 'cards' | 'sets' = 'cards';

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page = 1;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(48)
  limit = 24;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(GACHA_TIERS)
  rarity?: string;

  @IsIn(['all', 'owned', 'missing'])
  ownership: 'all' | 'owned' | 'missing' = 'all';

  @IsIn(['all', 'complete', 'near'])
  progress: 'all' | 'complete' | 'near' = 'all';

  @IsOptional()
  @Matches(
    /^(orphan|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i,
  )
  animeId?: string;
}
