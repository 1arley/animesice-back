import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class ClaimGachaDto {
  @ApiProperty({ description: 'ID do preview (GachaSpin) a resgatar.' })
  @IsString()
  @IsNotEmpty()
  spinId!: string;
}

export class SetFeaturedGachaCardDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userCardId!: string;
}

export class RerollGachaCardDto {
  @ApiProperty({ description: 'ID da UserCard (sua) a rerrolar.' })
  @IsString()
  @IsNotEmpty()
  userCardId!: string;
}

export class BurnGachaCardDto {
  @ApiProperty({ description: 'ID da UserCard (sua) a queimar.' })
  @IsString()
  @IsNotEmpty()
  userCardId!: string;
}

export class BuyCosmeticDto {
  @ApiProperty({ description: 'Chave do cosmético (ex.: FRAME_AURORA).' })
  @IsString()
  @IsNotEmpty()
  key!: string;
}

export class CreateListingDto {
  @ApiProperty({ description: 'ID da UserCard (sua) a anunciar.' })
  @IsString()
  @IsNotEmpty()
  userCardId!: string;

  @ApiProperty({ description: 'Preço em Crystal (inteiro ≥ 1).' })
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  price!: number;
}

export class NewTradeDto {
  @ApiProperty({ type: [String], minItems: 1, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  offeredUserCardIds?: string[];

  @ApiProperty({ type: [String], minItems: 1, maxItems: 3 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(3)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  requestedUserCardIds?: string[];

  @IsOptional()
  @IsString()
  offeredUserCardId?: string;
  @IsOptional()
  @IsString()
  requestedUserCardId?: string;
}

export enum WishlistPriorityDto {
  LOW = 'LOW',
  NORMAL = 'NORMAL',
  HIGH = 'HIGH',
}

export class UpsertCardWishlistDto {
  @ApiProperty({ enum: WishlistPriorityDto, required: false })
  @IsOptional()
  @IsEnum(WishlistPriorityDto)
  priority?: WishlistPriorityDto;

  @ApiProperty({
    enum: ['NORMAL', 'HOLO', 'GOLD'],
    isArray: true,
    required: false,
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(['NORMAL', 'HOLO', 'GOLD'], { each: true })
  acceptedFoils?: string[];

  @ApiProperty({
    enum: ['MINT', 'NM', 'EX', 'PLAYED', 'POOR'],
    required: false,
  })
  @IsOptional()
  @IsString()
  @IsIn(['MINT', 'NM', 'EX', 'PLAYED', 'POOR'])
  minCondition?: string;

  @ApiProperty({ required: false, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  maxEdition?: number;
}

export class UpsertSetWishlistDto {
  @ApiProperty({ enum: WishlistPriorityDto, required: false })
  @IsOptional()
  @IsEnum(WishlistPriorityDto)
  priority?: WishlistPriorityDto;
}

export class WishlistPrivacyDto {
  @ApiProperty()
  @IsBoolean()
  isPublic!: boolean;
}
