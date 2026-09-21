import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { Public } from '@/auth/decorators/public.decorator';
import { Roles } from '@/auth/roles.decorators';
import { RolesGuard } from '@/auth/roles.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import {
  BuyBoxDto,
  CreateBuyOrderDto,
  CreateCardListingDto,
  CreateSkinListingDto,
  OpenBoxDto,
  MarketQueryDto,
  MarketHistoryDto,
  EconomicEventDto,
  EconomyAdminReasonDto,
  ReviewSaleDto,
} from './economy.dto';
import { EconomyService } from './economy.service';

@ApiTags('gacha-economy')
@ApiBearerAuth('JWT-auth')
@UseGuards(JwtAuthGuard)
@Controller('gacha/economy')
export class EconomyController {
  constructor(private readonly economy: EconomyService) {}

  @Public()
  @Get('odds')
  odds() {
    return this.economy.odds();
  }

  @Public()
  @Get('market/listings')
  listings(@Query() query: MarketQueryDto) {
    return this.economy.listings(query);
  }

  @Get('market/listings/mine')
  myListings(@Req() req: AuthenticatedRequest, @Query() query: MarketQueryDto) {
    return this.economy.listings(query, req.user.id);
  }

  @Public()
  @Get('market/orders')
  orders(@Query() query: MarketQueryDto) {
    return this.economy.orders(query);
  }

  @Get('market/orders/mine')
  myOrders(@Req() req: AuthenticatedRequest, @Query() query: MarketQueryDto) {
    return this.economy.orders(query, req.user.id);
  }

  @Get('skins/mine')
  mySkins(@Req() req: AuthenticatedRequest) {
    return this.economy.ownedSkins(req.user.id);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('admin/event')
  configureEvent(
    @Req() req: AuthenticatedRequest,
    @Body() dto: EconomicEventDto,
  ) {
    return this.economy.configureEvent(req.user.id, dto);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('admin/sales/:id/review')
  reviewSale(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EconomyAdminReasonDto,
  ) {
    return this.economy.blockItem(req.user.id, 'CARD', id, dto.reason);
  }

  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  @Post('admin/skins/:id/block')
  blockSkin(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: EconomyAdminReasonDto,
  ) {
    return this.economy.blockItem(req.user.id, 'SKIN', id, dto.reason);
  }

  @Get()
  inventory(@Req() req: AuthenticatedRequest) {
    return this.economy.inventory(req.user.id);
  }

  @Post('daily')
  daily(@Req() req: AuthenticatedRequest) {
    return this.economy.claimDaily(req.user.id);
  }

  @Post('weekly')
  weekly(@Req() req: AuthenticatedRequest) {
    return this.economy.claimWeekly(req.user.id);
  }

  @Post('keys')
  buyKey(@Req() req: AuthenticatedRequest) {
    return this.economy.buyKey(req.user.id);
  }

  @Post('boxes')
  buyBox(@Req() req: AuthenticatedRequest, @Body() dto: BuyBoxDto) {
    return this.economy.buyBox(req.user.id, dto.tier);
  }

  @Post('boxes/open')
  openBox(@Req() req: AuthenticatedRequest, @Body() dto: OpenBoxDto) {
    return this.economy.openBox(req.user.id, dto.tier);
  }

  @Post('spin-reset')
  useSpinReset(@Req() req: AuthenticatedRequest) {
    return this.economy.useSpinReset(req.user.id);
  }

  @Post('market/orders')
  createBuyOrder(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateBuyOrderDto,
  ) {
    return this.economy.createBuyOrder(req.user.id, dto);
  }

  @Post('market/orders/:id/cancel')
  cancelBuyOrder(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.cancelBuyOrder(req.user.id, id);
  }

  @Post('market/cards/:id/sell-now')
  sellCardNow(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.sellCardNow(req.user.id, id);
  }

  @Post('market/cards/listings')
  createCardListing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCardListingDto,
  ) {
    return this.economy.createCardListing(
      req.user.id,
      dto.userCardId,
      dto.price,
    );
  }

  @Post('market/cards/listings/:id/buy')
  buyCardListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.buyCardListing(req.user.id, id);
  }

  @Post('market/cards/listings/:id/cancel')
  cancelCardListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.cancelCardListing(req.user.id, id);
  }

  @Post('market/skins/listings')
  createSkinListing(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateSkinListingDto,
  ) {
    return this.economy.createSkinListing(
      req.user.id,
      dto.userSkinId,
      dto.price,
    );
  }

  @Post('market/skins/:id/sell-now')
  sellSkinNow(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.sellSkinNow(req.user.id, id);
  }

  @Post('market/skins/listings/:id/buy')
  buySkinListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.buySkinListing(req.user.id, id);
  }

  @Post('market/skins/listings/:id/cancel')
  cancelSkinListing(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.cancelSkinListing(req.user.id, id);
  }

  @Public()
  @Get('market/history')
  history(@Query() query: MarketHistoryDto) {
    return this.economy.marketHistory(query.type, query.itemId, query);
  }

  @Post('market/visit')
  visitMarket(@Req() req: AuthenticatedRequest) {
    return this.economy.visitMarket(req.user.id);
  }

  @Get('market/mission')
  marketMission(@Req() req: AuthenticatedRequest) {
    return this.economy.marketMission(req.user.id);
  }

  @Post('market/mission/claim')
  claimMarketMission(@Req() req: AuthenticatedRequest) {
    return this.economy.claimMarketMission(req.user.id);
  }

  @Get('shop')
  shop(@Req() req: AuthenticatedRequest) {
    return this.economy.officialShop(req.user.id);
  }

  @Post('shop/:id/buy')
  buyOffer(@Req() req: AuthenticatedRequest, @Param('id') id: string) {
    return this.economy.buyOfficialOffer(req.user.id, id);
  }
}
