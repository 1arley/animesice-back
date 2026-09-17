import {
  Body,
  Controller,
  Delete,
  DefaultValuePipe,
  Get,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GachaService } from '@/gacha/gacha.service';
import {
  BuyCosmeticDto,
  BurnGachaCardDto,
  ClaimGachaDto,
  CreateListingDto,
  NewTradeDto,
  RerollGachaCardDto,
  SetFeaturedGachaCardDto,
} from '@/gacha/dto/gacha.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';
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
  @ApiOperation({ summary: 'Resgata preview (1 a cada 6h)' })
  claim(@Req() req: AuthenticatedRequest, @Body() dto: ClaimGachaDto) {
    return this.gachaService.claim(req.user.id, dto.spinId);
  }

  @Post('claim-compensation')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Resgata compensação pendente (giro garantido, uma vez)',
  })
  claimCompensation(@Req() req: AuthenticatedRequest) {
    return this.gachaService.claimCompensation(req.user.id);
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

  @Get('points')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Alias de crystals: saldo e extrato de Crystal',
    deprecated: true,
  })
  points(
    @Req() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.gachaService.points(req.user.id, page, limit);
  }

  @Get('shop')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Loja de Crystal: catálogo + saldo + posses' })
  shop(@Req() req: AuthenticatedRequest) {
    return this.gachaService.shop(req.user.id);
  }

  @Post('reroll')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Reroll de condition/foil (10% do value, pode piorar)',
  })
  reroll(@Req() req: AuthenticatedRequest, @Body() dto: RerollGachaCardDto) {
    return this.gachaService.reroll(req.user.id, dto.userCardId);
  }

  @Post('burn')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Queima carta e devolve 40% do valor em Crystal' })
  burn(@Req() req: AuthenticatedRequest, @Body() dto: BurnGachaCardDto) {
    return this.gachaService.burn(req.user.id, dto.userCardId);
  }

  @Post('cosmetics')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Compra um cosmético da loja com Crystal' })
  buyCosmetic(@Req() req: AuthenticatedRequest, @Body() dto: BuyCosmeticDto) {
    return this.gachaService.buyCosmetic(req.user.id, dto.key);
  }

  @Patch('card-back')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  setCardBack(
    @Req() req: AuthenticatedRequest,
    @Body() body: { key: string | null },
  ) {
    return this.gachaService.setCardBack(req.user.id, body.key);
  }

  @Get('admin/card-backs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCardBacks() {
    return this.gachaService.adminCardBacks();
  }

  @Post('admin/card-backs')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCreateCardBack(
    @Req() req: AuthenticatedRequest,
    @Body()
    body: {
      key: string;
      name: string;
      description?: string;
      svg: string;
      previewUrl?: string;
      price?: number;
      status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    },
  ) {
    return this.gachaService.adminCreateCardBack(body, req.user.id);
  }

  @Patch('admin/card-backs/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminUpdateCardBack(
    @Param('id') id: string,
    @Body()
    body: {
      key?: string;
      name?: string;
      description?: string;
      svg?: string;
      previewUrl?: string;
      price?: number;
      status?: 'DRAFT' | 'REVIEW' | 'PUBLISHED' | 'ARCHIVED';
    },
  ) {
    return this.gachaService.adminUpdateCardBack(id, body);
  }

  @Get('listings')
  @ApiOperation({ summary: 'Mercado: anúncios ativos com preço em Crystal' })
  listings(
    @Query('page') page: string,
    @Query('limit') limit: string,
    @Query('sort') sort?: string,
    @Query('rarity') rarity?: string,
    @Query('foil') foil?: string,
  ) {
    return this.gachaService.listings(
      parseInt(page ?? '1', 10) || DEFAULT_PAGE,
      parseInt(limit ?? '24', 10) || 24,
      sort,
      rarity,
      foil,
    );
  }

  @Get('listings/mine')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Meus anúncios ativos no mercado' })
  myListings(@Req() req: AuthenticatedRequest) {
    return this.gachaService.myListings(req.user.id);
  }

  @Post('listings')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Anuncia uma carta sua (escrow, 48h)' })
  createListing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateListingDto,
  ) {
    return this.gachaService.createListing(
      req.user.id,
      dto.userCardId,
      Number(dto.price),
    );
  }

  @Post('listings/:id/cancel')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Desanuncia (a carta volta pra você)' })
  cancelListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.cancelListing(req.user.id, id);
  }

  @Post('listings/:id/buy')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Buy-now: transfere pontos (taxa 10% queimada) e a carta',
  })
  buyListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.buyListing(req.user.id, id);
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

  @Get('crystals')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Saldo e extrato de Crystais' })
  crystals(
    @Req() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number,
    @Query('limit', new DefaultValuePipe(20), ParseIntPipe) limit: number,
  ) {
    return this.gachaService.crystals(req.user.id, page, limit);
  }

  @Post('crystals/daily')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Resgatar bônus diário de Crystais' })
  dailyBonus(@Req() req: AuthenticatedRequest) {
    return this.gachaService.dailyBonus(req.user.id);
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
  encyclopedia(
    @Req() req: OptionalAuthRequest,
    @Query('view') view?: 'cards' | 'sets',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('search') search?: string,
    @Query('rarity') rarity?: string,
    @Query('ownership') ownership?: 'all' | 'owned' | 'missing',
    @Query('animeId') animeId?: string,
    @Query('progress') progress?: 'all' | 'near' | 'complete',
  ) {
    const options = {
      ...(view !== undefined ? { view } : {}),
      ...(page !== undefined ? { page: Number(page) || 1 } : {}),
      ...(limit !== undefined ? { limit: Number(limit) || 24 } : {}),
      ...(search !== undefined ? { search } : {}),
      ...(rarity !== undefined ? { rarity } : {}),
      ...(ownership !== undefined ? { ownership } : {}),
      ...(animeId !== undefined ? { animeId } : {}),
      ...(progress !== undefined ? { progress } : {}),
    };
    return Object.keys(options).length > 0
      ? this.gachaService.encyclopedia(req.user?.id ?? null, options)
      : this.gachaService.encyclopedia(req.user?.id ?? null);
  }

  @Get('encyclopedia/suggestions')
  suggestions(@Query('q') query = '') {
    return this.gachaService.encyclopediaSuggestions(query);
  }

  @Get('collections')
  collections() {
    return this.gachaService.collections();
  }

  @Post('admin/collections')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCreateCollection(
    @Body()
    body: {
      name: string;
      slug: string;
      description?: string;
      version?: number;
      published?: boolean;
      cardIds?: string[];
    },
  ) {
    return this.gachaService.adminCreateCollection(body);
  }

  @Post('trades')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Propõe troca 1:1 (válida por 48h)' })
  createTrade(@Req() req: AuthenticatedRequest, @Body() dto: NewTradeDto) {
    return this.gachaService.createTrade(
      req.user.id,
      dto.offeredUserCardId,
      dto.requestedUserCardId,
    );
  }

  @Get('trades/mine')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Trocas em que sou parte (enviadas e recebidas, recentes)',
  })
  myTrades(@Req() req: AuthenticatedRequest) {
    return this.gachaService.myTrades(req.user.id);
  }

  @Post('trades/:id/accept')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Receptor aceita e a troca é aplicada atomically (swap de dono)',
  })
  acceptTrade(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.acceptTrade(req.user.id, id);
  }

  @Post('trades/:id/cancel')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Quem propôs desiste da troca' })
  cancelTrade(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.cancelTrade(req.user.id, id);
  }

  @Post('trades/:id/decline')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Receptor recusa a troca' })
  declineTrade(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.declineTrade(req.user.id, id);
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
    if (!body.rarity?.trim())
      throw new BadRequestException('Raridade obrigatória.');
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
    if (body.rarity !== undefined && !body.rarity.trim())
      throw new BadRequestException('Raridade inválida.');
    return this.gachaService.adminUpdateCard(id, body);
  }

  @Get('admin/rarities')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminRarities() {
    return this.gachaService.adminRarities();
  }

  @Post('admin/rarities')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCreateRarity(
    @Body()
    body: {
      name: string;
      slug: string;
      pointsBase?: number;
      dropWeight?: number;
      color?: string;
      active?: boolean;
    },
  ) {
    return this.gachaService.adminCreateRarity(body);
  }

  @Patch('admin/rarities/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminUpdateRarity(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      slug?: string;
      pointsBase?: number;
      dropWeight?: number;
      color?: string;
      active?: boolean;
    },
  ) {
    return this.gachaService.adminUpdateRarity(id, body);
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

  @Post('admin/users/:userId/points-adjust')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('ADJUST_GACHA_CRYSTALS', 'CrystalEvent')
  @ApiOperation({
    summary: 'Alias de crystals-adjust',
    deprecated: true,
  })
  adminAdjustPoints(
    @Param('userId') userId: string,
    @Body() body: { delta: number; reason: string },
  ) {
    return this.gachaService.adjustCrystals(userId, body.delta, body.reason);
  }

  @Post('admin/users/:userId/crystals-adjust')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('ADJUST_GACHA_CRYSTALS', 'CrystalEvent')
  @ApiOperation({
    summary: 'Ajuste de Crystal (delta inteiro, motivo obrigatório)',
  })
  adminAdjustCrystals(
    @Param('userId') userId: string,
    @Body() body: { delta: number; reason: string },
  ) {
    return this.gachaService.adjustCrystals(userId, body.delta, body.reason);
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
