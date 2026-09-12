import { IsNotEmpty, IsString } from 'class-validator';
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
