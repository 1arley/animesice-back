import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Matches,
  ValidateIf,
} from 'class-validator';
import {
  AdminNotificationAudience,
  AdminNotificationCategory,
} from '@prisma/client';

/** Limite por envio para públicos selecionados (o global usa lotes no banco). */
export const ADMIN_NOTIFICATION_MAX_SELECTED = 500;

export class SendAdminNotificationDto {
  @ApiProperty({
    enum: AdminNotificationAudience,
    description: 'SINGLE = um jogador, SELECTED = grupo, GLOBAL = todos',
  })
  @IsEnum(AdminNotificationAudience)
  audience!: AdminNotificationAudience;

  @ApiPropertyOptional({
    type: [String],
    description:
      'Destinatários de SINGLE/SELECTED. Ignorado quando audience = GLOBAL.',
  })
  @ValidateIf((dto: SendAdminNotificationDto) => dto.audience !== 'GLOBAL')
  @IsArray()
  @ArrayMaxSize(ADMIN_NOTIFICATION_MAX_SELECTED)
  @IsUUID('4', { each: true })
  userIds?: string[];

  @ApiProperty({ enum: AdminNotificationCategory })
  @IsEnum(AdminNotificationCategory)
  category!: AdminNotificationCategory;

  @ApiProperty({ minLength: 3, maxLength: 120 })
  @IsString()
  @Length(3, 120)
  title!: string;

  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @Length(1, 2000)
  body!: string;

  @ApiPropertyOptional({
    description: 'Caminho interno opcional, ex.: /gacha ou /notificacoes',
  })
  @IsOptional()
  @IsString()
  @Length(1, 300)
  @Matches(/^\/(?!\/)[^\s\\]*$/, {
    message:
      'linkUrl deve ser um caminho interno iniciado por "/", sem espaços ou barras invertidas.',
  })
  linkUrl?: string;

  @ApiProperty({
    description:
      'UUID gerado pelo cliente. Reenvios com a mesma chave retornam o envio original.',
  })
  @IsUUID('4')
  dedupeKey!: string;

  @ApiPropertyOptional({
    description: 'Obrigatório como true para confirmar um envio global.',
  })
  @IsOptional()
  @IsBoolean()
  confirmGlobal?: boolean;
}
