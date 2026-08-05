import { Injectable, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';
import { extname } from 'path';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient | null;
  private readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const bucket = this.config.get<string>('SUPABASE_BUCKET');

    if (!url || !serviceRoleKey || !bucket) {
      this.client = null;
      this.bucket = '';
      return;
    }

    this.client = createClient(url, serviceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    this.bucket = bucket;
  }

  private ensureConfig(): { client: SupabaseClient; bucket: string } {
    if (!this.client) {
      throw new ForbiddenException('Supabase não configurado.');
    }
    return { client: this.client, bucket: this.bucket };
  }

  /**
   * Faz upload de um vídeo (mp4/m3u8/ts) para o bucket do Supabase Storage.
   * Retorna a publicUrl do bucket — o bucket DEVE ser público para o vídeo
   * ficar acessível de forma persistente. Signed URLs expiram (1h) e não são
   * adequadas para persistir como `videoUrl` permanente no banco.
   */
  async uploadVideo(
    buffer: Buffer,
    mimetype: string,
    originalname: string,
  ): Promise<{ url: string; path: string }> {
    const { client, bucket } = this.ensureConfig();

    const ext = extname(originalname) || '';
    const objectPath = `videos/${randomUUID()}${ext}`;

    const { error } = await client.storage
      .from(bucket)
      .upload(objectPath, buffer, {
        contentType: mimetype,
        upsert: false,
      });

    if (error) {
      throw new ForbiddenException(
        `Falha no upload para o Supabase: ${error.message}`,
      );
    }

    const { data: publicData } = client.storage
      .from(bucket)
      .getPublicUrl(objectPath);

    if (!publicData?.publicUrl) {
      throw new ForbiddenException('Não foi possível obter a URL do vídeo.');
    }

    return { url: publicData.publicUrl, path: objectPath };
  }
}
