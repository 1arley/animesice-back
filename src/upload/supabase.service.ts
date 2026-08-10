import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { extname } from 'path';

/** Mimetypes aceitos para avatar. */
export const ALLOWED_IMAGE_MIMETYPES = ['image/jpeg', 'image/jpg', 'image/png'];

/** Teto de tamanho de avatar (50KB conforme policy do bucket). */
export const MAX_AVATAR_BYTES = 50 * 1024;

/** Sniff de magic bytes: JPEG (FF D8 FF) e PNG (89 50 4E 47). */
function sniffImageExt(buffer: Buffer): 'jpg' | 'png' | null {
  if (buffer.length > 2 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    return 'jpg';
  }
  if (
    buffer.length > 3 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47
  ) {
    return 'png';
  }
  return null;
}

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient | null;
  private readonly bucket: string;

  // S3-compatible storage (Supabase Storage S3 protocol) p/ avatares.
  private readonly s3: S3Client | null = null;
  private readonly avatarBucket: string;
  private readonly publicBaseUrl: string;

  constructor(private readonly config: ConfigService) {
    const url = this.config.get<string>('SUPABASE_URL');
    const serviceRoleKey = this.config.get<string>('SUPABASE_SERVICE_ROLE_KEY');
    const bucket = this.config.get<string>('SUPABASE_BUCKET');

    if (!url || !serviceRoleKey || !bucket) {
      this.client = null;
      this.bucket = '';
    } else {
      this.client = createClient(url, serviceRoleKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      this.bucket = bucket;
    }

    // S3 protocol — usa access keys geradas no dashboard (Storage → S3).
    const accessKeyId = this.config.get<string>('SUPABASE_S3_ACCESS_KEY_ID');
    const secretAccessKey = this.config.get<string>(
      'SUPABASE_S3_SECRET_ACCESS_KEY',
    );
    const region = this.config.get<string>('SUPABASE_S3_REGION') || 'sa-east-1';

    this.avatarBucket =
      this.config.get<string>('SUPABASE_AVATAR_BUCKET') || 'users_icons';

    if (url && accessKeyId && secretAccessKey) {
      this.s3 = new S3Client({
        region,
        endpoint: `${url}/storage/v1/s3`,
        forcePathStyle: true,
        credentials: { accessKeyId, secretAccessKey },
      });
      this.publicBaseUrl = `${url}/storage/v1/object/public`;
    } else {
      this.publicBaseUrl = '';
    }
  }

  private ensureConfig(): { client: SupabaseClient; bucket: string } {
    if (!this.client) {
      throw new ForbiddenException('Supabase não configurado.');
    }
    return { client: this.client, bucket: this.bucket };
  }

  private ensureS3(): { s3: S3Client; bucket: string; base: string } {
    if (!this.s3 || !this.avatarBucket || !this.publicBaseUrl) {
      throw new ForbiddenException('Storage de imagens não configurado.');
    }
    return { s3: this.s3, bucket: this.avatarBucket, base: this.publicBaseUrl };
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

  /**
   * Upload de avatar (JPEG/PNG ≤ 50KB) via S3 protocol para o bucket
   * `users_icons`. Valida magic bytes (não confia no mimetype do cliente).
   * Retorna a URL pública — bucket é público na leitura.
   */
  async uploadImage(
    buffer: Buffer,
    mimetype: string,
    originalname: string,
    userId: string,
  ): Promise<{ url: string; path: string }> {
    const { s3, bucket, base } = this.ensureS3();

    const mime = mimetype?.toLowerCase() ?? '';
    if (!ALLOWED_IMAGE_MIMETYPES.includes(mime)) {
      throw new BadRequestException(
        'Tipo de arquivo inválido. Aceitos: JPG, PNG.',
      );
    }

    if (!buffer || buffer.length === 0 || buffer.length > MAX_AVATAR_BYTES) {
      throw new BadRequestException(
        'Imagem muito grande ou vazia. Tamanho máximo: 50KB.',
      );
    }

    const ext = sniffImageExt(buffer);
    if (!ext) {
      throw new BadRequestException(
        'Arquivo de imagem inválido (magic bytes não reconhecidos).',
      );
    }

    // contentType normalizado — Supabase rejeita image/jpg como content-type.
    const contentType = mime === 'image/jpg' ? 'image/jpeg' : mime;

    const objectPath = `${userId}/${randomUUID()}.${ext}`;

    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: objectPath,
        Body: buffer,
        ContentType: contentType,
      }),
    );

    const url = `${base}/${bucket}/${objectPath}`;
    return { url, path: objectPath };
  }

  /** Remove o objeto de avatar por URL pública. Falha silenciosa. */
  async deleteAvatarImage(url: string): Promise<void> {
    if (!url || !this.s3 || !this.avatarBucket || !this.publicBaseUrl) return;

    const prefix = `${this.publicBaseUrl}/${this.avatarBucket}/`;
    if (!url.startsWith(prefix)) return;

    const key = url.slice(prefix.length);
    if (!key) return;

    await this.s3
      .send(new DeleteObjectCommand({ Bucket: this.avatarBucket, Key: key }))
      .catch(() => undefined);
  }
}
