import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GachaService } from '@/gacha/gacha.service';
import { RollGachaDto } from '@/gacha/dto/gacha.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';
import { GACHA_TIERS } from '@/gacha/gacha.constants';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('gacha')
@Controller('gacha')
export class GachaController {
  constructor(private readonly gachaService: GachaService) {}

  @Post('roll')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Roll diário do gacha (1/dia)' })
  roll(@Req() req: AuthenticatedRequest, @Body() dto: RollGachaDto) {
    return this.gachaService.roll(req.user.id, dto.turnstileToken);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Status do roll diário e pity' })
  status(@Req() req: AuthenticatedRequest) {
    return this.gachaService.status(req.user.id);
  }

  @Get('collection')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Coleção de cartas (própria ou pública)' })
  collection(
    @Req() req: AuthenticatedRequest,
    @Query('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.gachaService.collection(
      userId || req.user.id,
      req.user.id,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
    );
  }

  @Get('admin/cards')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCards(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('search') search?: string,
    @Query('rarity') rarity?: string,
  ) {
    return this.gachaService.adminCards(
      Number(page) || 1,
      Number(limit) || 24,
      search,
      rarity,
    );
  }

  @Post('admin/cards')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('CREATE_GACHA_CARD', 'Card')
  adminCreateCard(
    @Body() body: { name: string; image?: string; rarity: string },
  ) {
    if (!(GACHA_TIERS as readonly string[]).includes(body.rarity)) {
      throw new BadRequestException(
        `Raridade inválida. Use: ${GACHA_TIERS.join(', ')}`,
      );
    }
    return this.gachaService.adminCreateCard(body);
  }

  @Patch('admin/cards/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('UPDATE_GACHA_CARD', 'Card')
  adminUpdateCard(
    @Param('id') id: string,
    @Body() body: { name?: string; image?: string; rarity?: string },
  ) {
    if (
      body.rarity !== undefined &&
      !(GACHA_TIERS as readonly string[]).includes(body.rarity)
    ) {
      throw new BadRequestException(
        `Raridade inválida. Use: ${GACHA_TIERS.join(', ')}`,
      );
    }
    return this.gachaService.adminUpdateCard(id, body);
  }

  @Get('admin/users/:userId/cards')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminUserCards(
    @Param('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
  ) {
    return this.gachaService.adminUserCards(
      userId,
      Number(page) || 1,
      Number(limit) || 50,
    );
  }

  @Post('admin/users/:userId/cards')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('GRANT_GACHA_CARD', 'UserCard')
  adminGrantUserCard(
    @Param('userId') userId: string,
    @Body() body: { cardId: string },
  ) {
    return this.gachaService.adminGrantUserCard(userId, body.cardId);
  }

  @Delete('admin/user-cards/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('DELETE_GACHA_USER_CARD', 'UserCard')
  adminDeleteUserCard(@Param('id') id: string) {
    return this.gachaService.adminDeleteUserCard(id);
  }

  @Post('admin/users/:userId/reset-roll')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('RESET_GACHA_ROLL', 'GachaRollDay')
  adminResetRoll(@Param('userId') userId: string) {
    return this.gachaService.adminResetRoll(userId);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Últimos pulls visíveis do gacha' })
  recent(@Query('limit') limit: string) {
    return this.gachaService.recent(parseInt(limit ?? '20', 10) || 20);
  }

  @Get('ranking')
  @ApiOperation({ summary: 'Ranking de colecionadores por valor' })
  ranking(@Query('limit') limit: string) {
    return this.gachaService.ranking(parseInt(limit ?? '20', 10) || 20);
  }
}
