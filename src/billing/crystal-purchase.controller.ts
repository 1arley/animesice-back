import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { Public } from '@/auth/decorators/public.decorator';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';
import { CreateCrystalCheckoutDto } from '@/gacha/economy/economy.dto';
import { CrystalPurchaseService } from './crystal-purchase.service';

export interface LivePixCrystalWebhook {
  event?: string;
  resource?: { reference?: string };
}

@ApiTags('crystal-purchases')
@Controller('billing/crystals')
export class CrystalPurchaseController {
  constructor(private readonly purchases: CrystalPurchaseService) {}

  @Post('checkout')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  checkout(
    @Req() req: AuthenticatedRequest,
    @Body() dto: CreateCrystalCheckoutDto,
  ) {
    return this.purchases.checkout(
      req.user.id,
      dto.packageId,
      dto.idempotencyKey,
    );
  }

  @Public()
  @Post('webhook')
  webhook(
    @Headers('x-livepix-webhook-secret') secret: string | undefined,
    @Body() body: LivePixCrystalWebhook,
  ) {
    this.purchases.assertWebhookSecret(secret);
    const reference = body.resource?.reference;
    if (!reference) throw new BadRequestException('Webhook sem referência.');
    return body.event === 'payment.reversed'
      ? this.purchases.reverse(reference)
      : this.purchases.settle(reference);
  }
}
