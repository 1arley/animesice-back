import {
  Controller,
  Get,
  Post,
  Delete,
  Body,
  Param,
  UseGuards,
  Req,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiBearerAuth,
  ApiResponse,
} from '@nestjs/swagger';
import { RoomService } from '@/room/room.service';
import { CreateRoomDto } from '@/room/dto/create-room.dto';
import { JwtAuthGuard } from '@/auth/jwt-auth.guard';
import { VerifiedGuard } from '@/auth/verified.guard';
import type { AuthenticatedRequest } from '@/common/interfaces/request.interface';

@ApiTags('room')
@Controller('room')
export class RoomController {
  constructor(private readonly roomService: RoomService) {}

  @Post()
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Criar sala de watch party' })
  @ApiResponse({ status: 201, description: 'Sala criada' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Anime ou episódio não encontrado' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  create(@Req() req: AuthenticatedRequest, @Body() dto: CreateRoomDto) {
    return this.roomService.createRoom(req.user.id, dto);
  }

  @Get(':slug')
  @ApiOperation({ summary: 'Obter detalhes da sala por slug' })
  @ApiResponse({ status: 200, description: 'Sala encontrada' })
  @ApiResponse({ status: 404, description: 'Sala não encontrada ou expirada' })
  getBySlug(@Param('slug') slug: string) {
    return this.roomService.getRoomBySlug(slug);
  }

  @Get(':slug/messages')
  @ApiOperation({ summary: 'Carregar histórico de mensagens da sala' })
  getMessages(@Param('slug') slug: string) {
    return this.roomService
      .getRoomBySlug(slug)
      .then((room) => this.roomService.getMessages(room.id));
  }

  @Delete(':slug')
  @UseGuards(JwtAuthGuard, VerifiedGuard)
  @ApiBearerAuth('JWT-auth')
  @ApiOperation({ summary: 'Deletar sala (apenas criador)' })
  @ApiResponse({ status: 200, description: 'Sala deletada' })
  @ApiResponse({ status: 403, description: 'Sem permissão' })
  @ApiResponse({
    status: 403,
    description: 'Conta não verificada',
  })
  delete(@Req() req: AuthenticatedRequest, @Param('slug') slug: string) {
    return this.roomService
      .getRoomBySlug(slug)
      .then((room) => this.roomService.deleteRoom(req.user.id, room.id));
  }
}
