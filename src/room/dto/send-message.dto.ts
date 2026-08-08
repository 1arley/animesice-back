import { IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class SendMessageDto {
  @ApiProperty({ description: 'ID da sala' })
  @IsUUID()
  roomId!: string;

  @ApiProperty({ description: 'Conteúdo da mensagem' })
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  content!: string;
}
