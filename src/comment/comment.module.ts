import { Module } from '@nestjs/common';
import { CommentService } from '@/comment/comment.service';
import { CommentController } from '@/comment/comment.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';

@Module({
  imports: [PrismaModule, AuthModule],
  controllers: [CommentController],
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}
