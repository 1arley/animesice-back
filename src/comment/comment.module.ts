import { Module } from '@nestjs/common';
import { CommentService } from '@/comment/comment.service';
import { CommentController } from '@/comment/comment.controller';
import { PrismaModule } from '@/prisma/prisma.module';
import { AuthModule } from '@/auth/auth.module';
import { NotificationModule } from '@/notification/notification.module';

@Module({
  imports: [PrismaModule, AuthModule, NotificationModule],
  controllers: [CommentController],
  providers: [CommentService],
  exports: [CommentService],
})
export class CommentModule {}
