import {
  ArrayMaxSize,
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDefined,
  IsEnum,
  IsInt,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  ValidateIf,
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

export class GachaCollectionPreferencesDto {
  @ApiProperty({ nullable: true })
  @IsDefined()
  @ValidateIf(
    (value: GachaCollectionPreferencesDto) =>
      value.favoriteCollectionId !== null,
  )
  @IsString()
  @IsNotEmpty()
  favoriteCollectionId!: string | null;

  @ApiProperty({ type: [String], maxItems: 3, required: false })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(3)
  @ArrayUnique()
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  pinnedCollectionIds?: string[];
}

export class GachaEngagementPilotDto {
  @ApiProperty({ minimum: 0, maximum: 100 })
  @IsInt()
  @Min(0)
  @Max(100)
  percent!: number;
}

export class CreateCrystalCodeDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  crystals!: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2_147_483_647)
  maxUses?: number;

  @IsString()
  @IsOptional()
  expiresAt?: string;
}

export class UpdateCrystalCodeDto {
  @IsString()
  @IsOptional()
  code?: string;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2_147_483_647)
  crystals?: number;

  @IsInt()
  @IsOptional()
  @Min(1)
  @Max(2_147_483_647)
  maxUses?: number;

  @IsBoolean()
  @IsOptional()
  active?: boolean;

  @IsString()
  @IsOptional()
  expiresAt?: string;
}

export class RedeemCrystalCodeDto {
  @ApiProperty({ description: 'Código a resgatar.' })
  @IsString()
  @IsNotEmpty()
  code!: string;
}

export class ToggleCrystalCodeDto {
  @ApiProperty({ description: 'Ativar ou desativar o código.' })
  @IsBoolean()
  active!: boolean;
}

export class RerollGachaCardDto {
  @ApiProperty({ description: 'ID da UserCard (sua) a rerrolar.' })
  @IsString()
  @IsNotEmpty()
  userCardId!: string;
}

export class ApplyRankingDto {
  @ApiProperty({ description: 'ID da UserCard (sua) para aplicar ao ranking.' })
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

export class EquipGachaSkinDto {
  @ApiProperty({ nullable: true })
  @IsDefined()
  @ValidateIf((value: EquipGachaSkinDto) => value.skinId !== null)
  @IsString()
  skinId!: string | null;
}

export class ApplyGachaSkinDto {
  @ApiProperty({ nullable: true })
  @IsDefined()
  @ValidateIf((value: ApplyGachaSkinDto) => value.skinId !== null)
  @IsString()
  skinId!: string | null;
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
  @ApiProperty({ type: [String], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
  @IsString({ each: true })
  @IsNotEmpty({ each: true })
  offeredUserCardIds?: string[];

  @ApiProperty({ type: [String], minItems: 1, maxItems: 5 })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(5)
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
