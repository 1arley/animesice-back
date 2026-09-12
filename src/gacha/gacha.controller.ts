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
import { ClaimGachaDto, SetFeaturedGachaCardDto } from '@/gacha/dto/gacha.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';
import { GACHA_TIERS } from '@/gacha/gacha.constants';
import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { Request } from 'express';

type OptionalAuthRequest = Request & { user?: AuthenticatedRequest['user'] };

@ApiTags('gacha')
@Controller('gacha')
export class GachaController {
  constructor(private readonly gachaService: GachaService) {}

  @Post('roll')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Roll diário do gacha (legado: spin + claim imediato)',
  })
  roll() {
    return this.gachaService.roll();
  }

  @Post('spin')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Gira preview (5/hora, sem ownership)' })
  spin(@Req() req: AuthenticatedRequest) {
    return this.gachaService.spin(req.user.id);
  }

  @Post('claim')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Resgata preview (1 a cada 12h)' })
  claim(@Req() req: AuthenticatedRequest, @Body() dto: ClaimGachaDto) {
    return this.gachaService.claim(req.user.id, dto.spinId);
  }

  @Get('spins')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Previews da hora atual' })
  spins(@Req() req: AuthenticatedRequest) {
    return this.gachaService.spins(req.user.id);
  }

  @Get('status')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Status do roll diário e pity' })
  status(@Req() req: AuthenticatedRequest) {
    return this.gachaService.status(req.user.id);
  }

  @Get('collection')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({ summary: 'Coleção de cartas (própria ou pública)' })
  collection(
    @Req() req: OptionalAuthRequest,
    @Query('userId') userId: string,
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('sort') sort?: string,
    @Query('rarity') rarity?: string,
    @Query('foil') foil?: string,
  ) {
    const viewerId = req.user?.id ?? null;
    const ownerId = userId || viewerId;
    if (!ownerId)
      throw new BadRequestException('Informe o usuário da coleção.');
    return this.gachaService.collection(
      ownerId,
      viewerId,
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
      sort,
      rarity,
      foil,
    );
  }

  @Get('featured')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  featured(@Req() req: AuthenticatedRequest) {
    return this.gachaService.featured(req.user.id);
  }

  @Patch('featured')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  setFeatured(
    @Req() req: AuthenticatedRequest,
    @Body() dto: SetFeaturedGachaCardDto,
  ) {
    return this.gachaService.setFeatured(req.user.id, dto.userCardId);
  }

  @Delete('featured')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  removeFeatured(@Req() req: AuthenticatedRequest) {
    return this.gachaService.removeFeatured(req.user.id);
  }

  @Get('cards/:id')
  publicCard(@Param('id') id: string) {
    return this.gachaService.publicCard(id);
  }

  @Get('featured/:userId')
  publicFeatured(@Param('userId') userId: string) {
    return this.gachaService.publicFeatured(userId);
  }

  @Get('encyclopedia')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Catálogo completo por anime com flag de posse (enciclopédia da coleção)',
  })
  encyclopedia(@Req() req: OptionalAuthRequest) {
    return this.gachaService.encyclopedia(req.user?.id ?? null);
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
