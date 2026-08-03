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
   * Se o bucket for público, retorna a publicUrl; se for privado, gera uma
   * signed URL válida por 1h (3600s).
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

    // getPublicUrl sempre retorna uma URL "/object/public/{bucket}/{path}".
    // Para buckets públicos ela é acessível diretamente; para buckets
    // privados geramos uma signed URL válida por 1h (3600s). Como a API do
    // SDK não diferencia o tipo de bucket aqui, tentamos primeiro a URL
    // pública e geramos a signed URL como fallback.
    if (publicData?.publicUrl) {
      const unsignedUrl = publicData.publicUrl;
      const supabaseUrl = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
      const publicPathPrefix = `${supabaseUrl}/storage/v1/object/public/`;

      if (unsignedUrl.startsWith(publicPathPrefix)) {
        const { data: signed, error: signedError } = await client.storage
          .from(bucket)
          .createSignedUrl(objectPath, 3600);

        if (signedError || !signed?.signedUrl) {
          // Bucket provavelmente público: signed URL falha, usamos a publicUrl.
          return { url: unsignedUrl, path: objectPath };
        }
        return { url: signed.signedUrl, path: objectPath };
      }

      return { url: unsignedUrl, path: objectPath };
    }

    throw new ForbiddenException('Não foi possível obter a URL do vídeo.');
  }
}
