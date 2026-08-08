import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class JoinRoomDto {
  @ApiProperty({ description: 'Slug da sala' })
  @IsString()
  slug!: string;
}
