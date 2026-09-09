import { IsNotEmpty, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class RollGachaDto {
  @ApiProperty({
    required: false,
    description: 'Token do Turnstile (captcha) obtido na página do gacha.',
  })
  @IsOptional()
  @IsString()
  turnstileToken?: string;
}

export class SetFeaturedGachaCardDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  userCardId!: string;
}
