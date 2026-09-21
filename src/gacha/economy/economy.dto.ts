import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
  IsBoolean,
  IsArray,
  ArrayUnique,
  MaxLength,
} from 'class-validator';
import { Type } from 'class-transformer';
import { BOX_TIERS } from './economy.rules';
import type { BoxTier } from './economy.rules';

export class BuyBoxDto {
  @ApiProperty({ enum: BOX_TIERS })
  @IsEnum(BOX_TIERS)
  tier!: BoxTier;
}

export class OpenBoxDto extends BuyBoxDto {}

export class CreateBuyOrderDto {
  @ApiProperty({ enum: ['CARD', 'SKIN'] })
  @IsEnum(['CARD', 'SKIN'])
  itemType!: 'CARD' | 'SKIN';

  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  price!: number;

  @IsOptional()
  @IsEnum(['NORMAL', 'HOLO', 'GOLD'])
  foil?: 'NORMAL' | 'HOLO' | 'GOLD';

  @IsOptional()
  @IsEnum(['MINT', 'NM', 'EX', 'PLAYED', 'POOR'])
  condition?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxEdition?: number;
}

export class MarketQueryDto {
  @IsOptional()
  @IsEnum(['CARD', 'SKIN'])
  itemType?: 'CARD' | 'SKIN';

  @IsOptional()
  @IsString()
  itemId?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 20;
}

export class MarketHistoryDto {
  @IsEnum(['CARD', 'SKIN'])
  type!: 'CARD' | 'SKIN';

  @IsString()
  @IsNotEmpty()
  itemId!: string;

  @IsOptional()
  @IsEnum(['NORMAL', 'HOLO', 'GOLD'])
  foil?: string;

  @IsOptional()
  @IsEnum(['MINT', 'NM', 'EX', 'PLAYED', 'POOR'])
  condition?: string;
}

export class EconomyAdminReasonDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  reason!: string;
}

export class ReviewSaleDto extends EconomyAdminReasonDto {
  @IsBoolean()
  suspicious!: boolean;

  @IsOptional()
  @IsBoolean()
  blockRecurring?: boolean;
}

export class EconomicEventDto extends EconomyAdminReasonDto {
  @IsInt()
  @Min(1)
  @Max(22)
  startDay!: number;

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  cardIds!: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  skinIds!: string[];

  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  cardBackKeys!: string[];
}

export class CreateSkinListingDto {
  @IsString()
  @IsNotEmpty()
  userSkinId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  price!: number;
}

export class CreateCardListingDto {
  @IsString()
  @IsNotEmpty()
  userCardId!: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  price!: number;
}

export class CreateCrystalCheckoutDto {
  @ApiProperty({
    enum: ['BRL_490', 'BRL_990', 'BRL_1990', 'BRL_2990', 'BRL_4990'],
  })
  @IsEnum(['BRL_490', 'BRL_990', 'BRL_1990', 'BRL_2990', 'BRL_4990'])
  packageId!: 'BRL_490' | 'BRL_990' | 'BRL_1990' | 'BRL_2990' | 'BRL_4990';

  @IsString()
  @IsNotEmpty()
  idempotencyKey!: string;
}
