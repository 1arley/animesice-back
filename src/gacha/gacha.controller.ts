import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  DefaultValuePipe,
  ForbiddenException,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { GachaService } from '@/gacha/gacha.service';
import {
  ApplyRankingDto,
  BuyCosmeticDto,
  ApplyGachaSkinDto,
  BurnGachaCardDto,
  ClaimGachaDto,
  CreateListingDto,
  NewTradeDto,
  RerollGachaCardDto,
  SetFeaturedGachaCardDto,
  UpsertCardWishlistDto,
  UpsertSetWishlistDto,
  WishlistPrivacyDto,
  WishlistPriorityDto,
  EquipGachaSkinDto,
  GachaCollectionPreferencesDto,
  GachaEngagementPilotDto,
  CreateCrystalCodeDto,
  UpdateCrystalCodeDto,
  RedeemCrystalCodeDto,
  ToggleCrystalCodeDto,
} from '@/gacha/dto/gacha.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { OptionalJwtAuthGuard } from '@/auth/optional-jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { RolesGuard } from '@/auth/roles.guard';
import { Roles } from '@/auth/roles.decorators';
import { Audit } from '@/auth/decorators/audit.decorator';
import { DEFAULT_PAGE } from '@/common/constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import type { Request } from 'express';
import { GACHA_TIERS } from '@/gacha/gacha.constants';
import { GachaConfigService } from '@/gacha/gacha-config.service';
import { EconomyService } from '@/gacha/economy/economy.service';

type OptionalAuthRequest = Request & { user?: AuthenticatedRequest['user'] };

@ApiTags('gacha')
@Controller('gacha')
export class GachaController {
  constructor(
    private readonly gachaService: GachaService,
    private readonly gachaConfig: GachaConfigService,
    private readonly economy: EconomyService,
  ) {}

  @Get('wishlist')
  @UseGuards(OptionalJwtAuthGuard)
  wishlist(
    @Req() req: OptionalAuthRequest,
    @Query('userId') userId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('status') status?: 'pending' | 'complete',
    @Query('priority') priority?: 'LOW' | 'NORMAL' | 'HIGH',
    @Query('type') type?: 'cards' | 'sets',
  ) {
    const ownerId = userId || req.user?.id;
    if (!ownerId)
      throw new BadRequestException('Informe o usuário da wishlist.');
    return this.gachaService.wishlist(ownerId, req.user?.id ?? null, {
      page: Number(page) || 1,
      limit: Number(limit) || 24,
      status,
      priority: priority as WishlistPriorityDto | undefined,
      type,
    });
  }

  @Put('wishlist/cards/:cardId')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  upsertCardWishlist(
    @Req() req: AuthenticatedRequest,
    @Param('cardId') cardId: string,
    @Body() dto: UpsertCardWishlistDto,
  ) {
    return this.gachaService.upsertCardWishlist(req.user.id, cardId, dto);
  }

  @Delete('wishlist/cards/:cardId')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  deleteCardWishlist(
    @Req() req: AuthenticatedRequest,
    @Param('cardId') cardId: string,
  ) {
    return this.gachaService.deleteCardWishlist(req.user.id, cardId);
  }

  @Put('wishlist/sets/:animeId')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  upsertSetWishlist(
    @Req() req: AuthenticatedRequest,
    @Param('animeId') animeId: string,
    @Body() dto: UpsertSetWishlistDto,
  ) {
    return this.gachaService.upsertSetWishlist(req.user.id, animeId, dto);
  }

  @Delete('wishlist/sets/:animeId')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  deleteSetWishlist(
    @Req() req: AuthenticatedRequest,
    @Param('animeId') animeId: string,
  ) {
    return this.gachaService.deleteSetWishlist(req.user.id, animeId);
  }

  @Patch('wishlist/privacy')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  setWishlistPrivacy(
    @Req() req: AuthenticatedRequest,
    @Body() dto: WishlistPrivacyDto,
  ) {
    return this.gachaService.setWishlistPrivacy(req.user.id, dto.isPublic);
  }

  @Get('wishlist/interested/:cardId')
  @UseGuards(OptionalJwtAuthGuard)
  interestedWishlistUsers(
    @Param('cardId') cardId: string,
    @Query('animeId') animeId: string,
    @Query('condition') condition: string,
    @Query('foil') foil: string,
    @Query('edition') edition: string,
  ) {
    const parsedCondition = Number(condition);
    const parsedEdition = Number(edition);
    if (
      !Number.isFinite(parsedCondition) ||
      !Number.isInteger(parsedEdition) ||
      parsedEdition < 1
    ) {
      throw new BadRequestException('Variante da carta inválida.');
    }
    return this.gachaService.interestedWishlistUsers(cardId, animeId || null, {
      condition: parsedCondition,
      foil,
      edition: parsedEdition,
    });
  }

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

  @Get('skins')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Catálogo e coleção de skins' })
  skins(
    @Req() req: AuthenticatedRequest,
    @Query('page', new DefaultValuePipe(DEFAULT_PAGE), ParseIntPipe)
    page: number,
    @Query('limit', new DefaultValuePipe(48), ParseIntPipe) limit: number,
    @Query('search') search?: string,
  ) {
    return this.gachaService.skinCatalog(req.user.id, page, limit, search);
  }

  @Post('skins/spin')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Gira skin (grátis a cada 12h ou 1000 Crystals)' })
  spinSkin(@Req() req: AuthenticatedRequest) {
    return this.gachaService.spinSkin(req.user.id);
  }

  @Patch('skins/equip')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Equipa ou remove skin de perfil' })
  equipSkin(@Req() req: AuthenticatedRequest, @Body() dto: EquipGachaSkinDto) {
    return this.gachaService.equipSkin(req.user.id, dto.skinId ?? null);
  }

  @Get('user-cards/:id/skins')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Skins possuídas disponíveis para uma carta' })
  cardSkins(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.gachaService.cardSkins(req.user.id, id);
  }

  @Patch('user-cards/:id/skin')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Aplica ou remove skin de uma cópia de carta' })
  applyCardSkin(
    @Req() req: AuthenticatedRequest,
    @Param('id') id: string,
    @Body() dto: ApplyGachaSkinDto,
  ) {
    return this.gachaService.applyCardSkin(req.user.id, id, dto.skinId);
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

  @Post('apply-ranking')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Aplica pontos do reroll ao ranking (custa crystals)',
  })
  applyRanking(@Req() req: AuthenticatedRequest, @Body() dto: ApplyRankingDto) {
    return this.gachaService.applyRanking(req.user.id, dto.userCardId);
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

  @Get('card-backs/:key')
  @ApiOperation({ summary: 'SVG de uma capa publicada por key' })
  cardBackByKey(@Param('key') key: string) {
    return this.gachaService.cardBackByKey(key);
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
      type?: 'BACK' | 'FRAME' | 'HIGHLIGHT';
      rarity?: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
      svg?: string;
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
      type?: 'BACK' | 'FRAME' | 'HIGHLIGHT';
      rarity?: 'COMMON' | 'RARE' | 'EPIC' | 'LEGENDARY';
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
  @ApiOperation({ summary: 'Anuncia uma carta sua (escrow, 7 dias)' })
  createListing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateListingDto,
  ) {
    return this.economy.createCardListing(
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
    return this.economy.cancelCardListing(req.user.id, id);
  }

  @Post('listings/:id/buy')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Buy-now: transfere pontos (taxa 10% queimada) e a carta',
  })
  buyListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.buyCardListing(req.user.id, id);
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

  @Post('crystals/redeem')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  redeemCrystalCode(
    @Req() req: AuthenticatedRequest,
    @Body() dto: RedeemCrystalCodeDto,
  ) {
    return this.gachaService.redeemCrystalCode(req.user.id, dto.code);
  }

  @Get('admin/crystal-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCrystalCodes() {
    return this.gachaService.adminCrystalCodes();
  }

  @Post('admin/crystal-codes')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminCreateCrystalCode(@Body() dto: CreateCrystalCodeDto) {
    return this.gachaService.adminCreateCrystalCode(dto);
  }

  @Patch('admin/crystal-codes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminToggleCrystalCode(
    @Param('id') id: string,
    @Body() dto: ToggleCrystalCodeDto,
  ) {
    return this.gachaService.adminToggleCrystalCode(id, dto.active);
  }

  @Get('admin/crystal-codes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminGetCrystalCode(@Param('id') id: string) {
    return this.gachaService.adminGetCrystalCode(id);
  }

  @Put('admin/crystal-codes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminUpdateCrystalCode(
    @Param('id') id: string,
    @Body() dto: UpdateCrystalCodeDto,
  ) {
    return this.gachaService.adminUpdateCrystalCode(id, dto);
  }

  @Delete('admin/crystal-codes/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminDeleteCrystalCode(@Param('id') id: string) {
    return this.gachaService.adminDeleteCrystalCode(id);
  }

  @Post('crystals/daily')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Resgatar bônus diário de Crystais' })
  dailyBonus(@Req() req: AuthenticatedRequest) {
    return this.economy.claimDaily(req.user.id);
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

  @Get('collections/progress')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  collectionProgress(@Req() req: AuthenticatedRequest) {
    return this.gachaService.collectionProgress(req.user.id);
  }

  @Get('engagement-pilot')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  engagementPilot(@Req() req: AuthenticatedRequest) {
    return this.gachaService.engagementPilotStatus(req.user.id);
  }

  @Patch('collections/preferences')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  updateCollectionPreferences(
    @Req() req: AuthenticatedRequest,
    @Body() body: GachaCollectionPreferencesDto,
  ) {
    return this.gachaService.updateCollectionPreferences(
      req.user.id,
      body.favoriteCollectionId,
      body.pinnedCollectionIds ?? [],
    );
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
  @ApiOperation({ summary: 'Propõe troca de 1 a 3 cartas por lado (48h)' })
  createTrade(@Req() req: AuthenticatedRequest, @Body() dto: NewTradeDto) {
    if (
      (!dto.offeredUserCardIds && !dto.offeredUserCardId) ||
      (!dto.requestedUserCardIds && !dto.requestedUserCardId)
    ) {
      throw new BadRequestException('Informe cartas para os dois lados.');
    }
    return this.gachaService.createTrade(
      req.user.id,
      dto.offeredUserCardIds ?? dto.offeredUserCardId!,
      dto.requestedUserCardIds ?? dto.requestedUserCardId!,
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
    @Query('animeId') animeId?: string,
    @Query('status') status?: string,
    @Query('source') source?: string,
  ) {
    return this.gachaService.adminCards(
      Number(page) || 1,
      Number(limit) || 24,
      search,
      rarity,
      animeId,
      status,
      source,
    );
  }

  @Post('admin/cards')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('CREATE_GACHA_CARD', 'Card')
  adminCreateCard(
    @Body()
    body: {
      name: string;
      image?: string;
      imageHidden?: boolean;
      rarity: string;
      animeId?: string;
      source?: string;
      variantName?: string;
      variantType?: string;
    },
  ) {
    if (!(GACHA_TIERS as readonly string[]).includes(body.rarity))
      throw new BadRequestException('Raridade inválida.');
    if (!body.name?.trim()) throw new BadRequestException('Nome obrigatório.');
    if (!body.animeId?.trim())
      throw new BadRequestException('Anime obrigatório.');
    if (!body.image?.trim())
      throw new BadRequestException('Imagem obrigatória.');
    if (!/^https:\/\//i.test(body.image))
      throw new BadRequestException('Imagem deve usar HTTPS.');
    return this.gachaService.adminCreateCard({
      ...body,
      animeId: body.animeId,
    });
  }

  @Patch('admin/cards/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('UPDATE_GACHA_CARD', 'Card')
  adminUpdateCard(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      image?: string;
      imageHidden?: boolean;
      rarity?: string;
      animeId?: string;
      status?: string;
      variantName?: string;
      variantType?: string;
      reason?: string;
    },
    @Req() req?: AuthenticatedRequest,
  ) {
    if (
      body.rarity !== undefined &&
      !(GACHA_TIERS as readonly string[]).includes(body.rarity)
    )
      throw new BadRequestException('Raridade inválida.');
    if (body.animeId !== undefined && !body.animeId.trim())
      throw new BadRequestException('Anime obrigatório.');
    if (body.image !== undefined && !/^https:\/\//i.test(body.image))
      throw new BadRequestException('Imagem deve usar HTTPS.');
    if (body.status !== undefined && req?.user.role !== 'SUPERADMIN')
      throw new ForbiddenException('Somente SUPERADMIN pode alterar status.');
    if (
      (body.rarity !== undefined || body.animeId !== undefined) &&
      (!body.reason || body.reason.trim().length < 10)
    )
      throw new BadRequestException('Motivo deve ter ao menos 10 caracteres.');
    const { reason, ...data } = body;
    return this.gachaService.adminUpdateCard(id, data, {
      adminId: req!.user.id,
      reason: reason?.trim(),
    });
  }

  @Post('admin/cards/:id/publish')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Audit('PUBLISH_GACHA_CARD', 'Card')
  adminPublishCard(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.gachaService.adminUpdateCard(
      id,
      { status: 'ACTIVE' },
      { adminId: req.user.id },
    );
  }

  @Post('admin/cards/:id/archive')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Audit('ARCHIVE_GACHA_CARD', 'Card')
  adminArchiveCard(@Param('id') id: string, @Req() req: AuthenticatedRequest) {
    return this.gachaService.adminUpdateCard(
      id,
      { status: 'ARCHIVED' },
      { adminId: req.user.id },
    );
  }

  @Post('admin/skins')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('CREATE_GACHA_SKIN', 'GachaSkin')
  adminCreateSkin(
    @Body()
    body: {
      name: string;
      imageUrl: string;
      cardId?: string;
      sourceUrl?: string;
      active?: boolean;
    },
  ) {
    if (!body.name?.trim()) throw new BadRequestException('Nome obrigatório.');
    if (!/^https:\/\//i.test(body.imageUrl ?? ''))
      throw new BadRequestException('Imagem deve usar HTTPS.');
    if (body.sourceUrl && !/^https:\/\//i.test(body.sourceUrl))
      throw new BadRequestException('Fonte deve usar HTTPS.');
    return this.gachaService.adminCreateSkin(body);
  }

  @Patch('admin/skins/:id')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('UPDATE_GACHA_SKIN', 'GachaSkin')
  adminUpdateSkin(
    @Param('id') id: string,
    @Body()
    body: {
      name?: string;
      imageUrl?: string;
      sourceUrl?: string;
      active?: boolean;
      blocked?: boolean;
    },
  ) {
    if (body.imageUrl !== undefined && !/^https:\/\//i.test(body.imageUrl))
      throw new BadRequestException('Imagem deve usar HTTPS.');
    if (body.sourceUrl !== undefined && !/^https:\/\//i.test(body.sourceUrl))
      throw new BadRequestException('Fonte deve usar HTTPS.');
    return this.gachaService.adminUpdateSkin(id, body);
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

  @Patch('admin/user-cards/:id/value')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Audit('UPDATE_GACHA_USER_CARD_VALUE', 'UserCard')
  adminSetUserCardValue(
    @Param('id') id: string,
    @Body() body: { value: number | null; reason: string },
    @Req() req: AuthenticatedRequest,
  ) {
    if (
      body.value !== null &&
      (!Number.isSafeInteger(body.value) ||
        body.value < 0 ||
        body.value > 1_000_000)
    )
      throw new BadRequestException(
        'Valor deve ser inteiro entre 0 e 1000000.',
      );
    if (!body.reason?.trim() || body.reason.trim().length < 10)
      throw new BadRequestException('Motivo deve ter ao menos 10 caracteres.');
    return this.gachaService.adminSetUserCardValue(
      id,
      body.value,
      body.reason.trim(),
      req.user.id,
    );
  }

  @Get('admin/history')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminGachaHistory(
    @Query('cardId') cardId?: string,
    @Query('userCardId') userCardId?: string,
  ) {
    return this.gachaService.adminGachaHistory(cardId, userCardId);
  }

  @Post('admin/users/:userId/reset-roll')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @Audit('RESET_GACHA_ROLL', 'GachaRollDay')
  adminResetRoll(@Param('userId') userId: string) {
    return this.gachaService.adminResetRoll(userId);
  }

  @Get('admin/engagement-pilot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  adminEngagementPilot() {
    return this.gachaService.adminEngagementPilot();
  }

  @Patch('admin/engagement-pilot')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @Audit('UPDATE_GACHA_ENGAGEMENT_PILOT', 'SiteSetting')
  adminUpdateEngagementPilot(@Body() dto: GachaEngagementPilotDto) {
    return this.gachaService.adminUpdateEngagementPilot(dto.percent);
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

  // ── GachaConfig admin ────────────────────────────────────

  @Get('admin/config')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('ADMIN', 'SUPERADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Lista todas as configurações do gacha' })
  adminListConfig() {
    return this.gachaConfig.list();
  }

  @Patch('admin/config/:key')
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles('SUPERADMIN')
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Atualiza uma configuração do gacha' })
  async adminUpdateConfig(
    @Param('key') key: string,
    @Body()
    body: {
      value: import('@prisma/client').Prisma.InputJsonValue;
      reason?: string;
    },
    @Req() req: AuthenticatedRequest,
  ) {
    return this.gachaConfig.update(
      key,
      body.value,
      req.user.id,
      body.reason ?? 'Atualização administrativa',
    );
  }
}
