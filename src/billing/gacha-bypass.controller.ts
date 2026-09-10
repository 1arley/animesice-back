import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { GachaService } from '@/gacha/gacha.service';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import { Public } from '@/auth/decorators/public.decorator';
import { LivePixService } from '@/billing/livepix.service';
import { PrismaService } from '@/prisma/prisma.service';
import {
  GACHA_BYPASS_PRICE_CENTS,
  GACHA_BYPASS_TTL_MS,
} from '@/gacha/gacha.constants';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

interface LivePixWebhookBody {
  event?: string;
  resource?: { reference?: string; type?: string };
}

@ApiTags('gacha-bypass')
@Controller('gacha/bypass')
export class GachaBypassController {
  constructor(
    private readonly gacha: GachaService,
    private readonly livepix: LivePixService,
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({
    summary: 'Cria intenção de desbloqueio de claim via Pix (R$2,99)',
  })
  async create(@Req() req: AuthenticatedRequest) {
    const status = await this.gacha.status(req.user.id);
    if (status.canClaim) {
      return { alreadyUnlocked: true as const };
    }
    const active = await this.prisma.gachaBypass.findFirst({
      where: {
        userId: req.user.id,
        status: 'PENDING',
        expiresAt: { gt: new Date() },
      },
      orderBy: { createdAt: 'desc' },
    });
    // ponytail: 1 intenção pendente por vez; paga-não-reconciliada libera
    // direto, pendente antiga é substituída pela nova cobrança.
    if (active !== null) {
      const paid = await this.livepix.isPaid(active.reference, active.amount);
      if (paid) {
        await this.settle(active.reference, req.user.id);
        return { unlocked: true as const };
      }
      await this.prisma.gachaBypass.delete({
        where: { reference: active.reference },
      });
    }
    const frontend =
      this.config.get<string>('FRONTEND_URL') || 'http://localhost:3000';
    const checkout = await this.livepix.createBypassCharge(
      await this.displayName(req.user.id),
      GACHA_BYPASS_PRICE_CENTS,
      `${frontend.replace(/\/$/, '')}/gacha?bypass=pending`,
    );
    await this.prisma.gachaBypass.upsert({
      where: { reference: checkout.reference },
      create: {
        reference: checkout.reference,
        userId: req.user.id,
        amount: GACHA_BYPASS_PRICE_CENTS,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + GACHA_BYPASS_TTL_MS),
      },
      update: {
        userId: req.user.id,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + GACHA_BYPASS_TTL_MS),
      },
    });
    return { ...checkout, amountCents: GACHA_BYPASS_PRICE_CENTS };
  }

  @Get(':reference')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Consulta status da intenção de desbloqueio' })
  async poll(
    @Req() req: AuthenticatedRequest,
    @Param('reference') reference: string,
  ) {
    const intent = await this.prisma.gachaBypass.findFirst({
      where: { reference, userId: req.user.id },
    });
    if (!intent) throw new NotFoundException('Intenção não encontrada.');
    if (intent.status === 'PAID') return { status: 'PAID' as const };
    if (intent.expiresAt.getTime() <= Date.now()) {
      return { status: 'EXPIRED' as const };
    }
    const paid = await this.livepix.isPaid(intent.reference, intent.amount);
    if (paid) {
      await this.settle(intent.reference, intent.userId);
      return { status: 'PAID' as const };
    }
    return { status: 'PENDING' as const };
  }

  @Post('webhook')
  @Public()
  @ApiOperation({
    summary: 'Webhook LivePix — confirma pagamento e libera claim',
  })
  async webhook(@Body() body: LivePixWebhookBody) {
    const reference = body.resource?.reference;
    if (!reference) return { ok: true as const };
    // ponytail: valida contra a API antes de liberar; webhook é só gatilho.
    const intent = await this.prisma.gachaBypass.findUnique({
      where: { reference },
    });
    if (!intent || intent.status === 'PAID') return { ok: true as const };
    const paid = await this.livepix.isPaid(reference, intent.amount);
    if (paid) await this.settle(reference, intent.userId);
    return { ok: true as const };
  }

  private async displayName(userId: string): Promise<string> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { userName: true, name: true },
    });
    return user?.userName ?? user?.name ?? 'animesice';
  }

  private async settle(reference: string, userId: string): Promise<void> {
    await this.prisma.gachaBypass.updateMany({
      where: { reference, status: 'PENDING' },
      data: { status: 'PAID', paidAt: new Date() },
    });
    await this.gacha.unlockClaim(userId);
  }
}
