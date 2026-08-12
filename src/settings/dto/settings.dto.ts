import { IsString, IsOptional, IsBoolean, IsNotEmpty } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { NotificationType, NotificationChannel } from '@prisma/client';

export class ConfirmEmailChangeDto {
  @ApiProperty({ example: 'abc123token' })
  @IsString()
  @IsNotEmpty()
  token!: string;
}

export class UpdatePrivacyDto {
  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  profilePublic?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showActivity?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showFavorites?: boolean;

  @ApiProperty({ required: false })
  @IsOptional()
  @IsBoolean()
  showRatings?: boolean;
}

export class UpdateNotificationPrefDto {
  @ApiProperty({ enum: NotificationType })
  @IsString()
  typeId!: NotificationType;

  @ApiProperty({ enum: NotificationChannel })
  @IsString()
  channel!: NotificationChannel;

  @ApiProperty()
  @IsBoolean()
  enabled!: boolean;
}

export class UpdateSiteSettingsDto {
  @ApiProperty({ required: false, description: 'Nome do site' })
  @IsOptional()
  @IsString()
  siteName?: string;

  @ApiProperty({ required: false, description: 'Descrição do site' })
  @IsOptional()
  @IsString()
  siteDescription?: string;

  @ApiProperty({ required: false, description: 'Registro aberto ou fechado' })
  @IsOptional()
  @IsBoolean()
  registrationOpen?: boolean;

  @ApiProperty({ required: false, description: 'Manutenção ativa' })
  @IsOptional()
  @IsBoolean()
  maintenanceMode?: boolean;
}
