import { IsUUID } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

export class LeaveRoomDto {
  @ApiProperty({ description: 'ID da sala' })
  @IsUUID()
  roomId!: string;
}
