import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { ReportReason, ReportTargetType } from '@prisma/client';

export class CreateReportDto {
  @ApiProperty({ enum: ReportTargetType })
  @IsEnum(ReportTargetType)
  targetType!: ReportTargetType;

  @ApiProperty({
    description: 'ID do alvo (comment, room message, user, anime)',
  })
  @IsString()
  targetId!: string;

  @ApiProperty({ enum: ReportReason })
  @IsEnum(ReportReason)
  reason!: ReportReason;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  notes?: string;
}

export class ResolveReportDto {
  @ApiProperty({ required: false, description: 'Nota do moderador' })
  @IsOptional()
  @IsString()
  moderationNote?: string;
}

export class ModerateUserDto {
  @ApiProperty({ enum: ['WARN', 'MUTE', 'BAN', 'DELETE_CONTENT'] })
  @IsString()
  actionType!: 'WARN' | 'MUTE' | 'BAN' | 'DELETE_CONTENT';

  @ApiProperty({ required: false })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    required: false,
    description: 'Duração em horas (para MUTE/BAN)',
  })
  @IsOptional()
  hours?: number;
}
