import { IsInt, IsNotEmpty, IsString, Min } from 'class-validator';
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

  @ApiProperty({ description: 'Preço em pontos (inteiro ≥ 1).' })
  @IsInt()
  @Min(1)
  price!: number;
}

export class NewTradeDto {
  @ApiProperty({ description: 'ID da UserCard oferecida (sua própria).' })
  @IsString()
  @IsNotEmpty()
  offeredUserCardId!: string;

  @ApiProperty({ description: 'ID da UserCard pedida (do outro usuário).' })
  @IsString()
  @IsNotEmpty()
  requestedUserCardId!: string;
}
