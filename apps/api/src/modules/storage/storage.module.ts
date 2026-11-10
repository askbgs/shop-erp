import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import {
  BadRequestException, Controller, Get, Global, Injectable, Module, NotFoundException, Param, ParseUUIDPipe, Res, ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Response } from 'express';
import { AuthUser } from '../../common/auth-user';
import { CurrentUser } from '../../common/decorators';
import { PrismaService, Tx } from '../../prisma/prisma.service';

export const MAX_IMAGE_BYTES = 3 * 1024 * 1024;

/** Detects the real image type from the first bytes; the client's content-type is not trusted. */
export function sniffImage(buf: Buffer): 'image/jpeg' | 'image/png' | 'image/webp' | null {
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length > 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

/**
 * File storage. With R2 configured, bytes go to the bucket; without it they are kept in the
 * database, so uploads work on a fresh deployment with no extra setup. Either way files are
 * served by the API (same origin as the app, tenant-checked), so the bucket can stay private.
 */
@Injectable()
export class StorageService {
  private client?: S3Client;
  private bucket?: string;

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    const endpoint = config.get<string>('R2_ENDPOINT');
    this.bucket = config.get<string>('R2_BUCKET');
    if (endpoint && this.bucket) {
      this.client = new S3Client({
        region: 'auto',
        endpoint,
        credentials: { accessKeyId: config.get<string>('R2_ACCESS_KEY_ID')!, secretAccessKey: config.get<string>('R2_SECRET_ACCESS_KEY')! },
      });
    }
  }

  get enabled() {
    return !!this.client;
  }

  /** Validates an uploaded image and stores it. Returns the StoredFile row. */
  async saveImage(tx: Tx, tenantId: string, buf: Buffer, folder: string) {
    if (!buf?.length) throw new BadRequestException('No file received');
    if (buf.length > MAX_IMAGE_BYTES) throw new BadRequestException('Image is larger than 3 MB');
    const mime = sniffImage(buf);
    if (!mime) throw new BadRequestException('Only JPEG, PNG or WebP images can be uploaded');
    if (this.client) {
      const key = `${tenantId}/${folder}/${randomUUID()}.${mime.split('/')[1]}`;
      await this.client.send(new PutObjectCommand({ Bucket: this.bucket, Key: key, Body: buf, ContentType: mime, CacheControl: 'private, max-age=31536000, immutable' }));
      return tx.storedFile.create({ data: { tenantId, mime, size: buf.length, r2Key: key } });
    }
    return tx.storedFile.create({ data: { tenantId, mime, size: buf.length, data: new Uint8Array(buf) } });
  }

  async read(tenantId: string, id: string): Promise<{ mime: string; body: Buffer }> {
    const f = await this.prisma.storedFile.findFirst({ where: { id, tenantId } });
    if (!f) throw new NotFoundException('File not found');
    if (f.data) return { mime: f.mime, body: Buffer.from(f.data) };
    if (!f.r2Key || !this.client) throw new NotFoundException('File not available');
    const obj = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: f.r2Key }));
    return { mime: f.mime, body: Buffer.from(await obj.Body!.transformToByteArray()) };
  }

  /** Removes the bytes from R2 (database rows are deleted by the caller's transaction). */
  async removeBlob(r2Key: string | null) {
    if (r2Key && this.client) await this.client.send(new DeleteObjectCommand({ Bucket: this.bucket, Key: r2Key })).catch(() => undefined);
  }

  // Repair photos still use direct browser-to-R2 uploads.
  async uploadUrl(tenantId: string, folder: string, contentType: string) {
    if (!this.client) throw new ServiceUnavailableException('File storage (R2) is not configured');
    const ext = contentType === 'image/png' ? 'png' : contentType === 'image/webp' ? 'webp' : 'jpg';
    const key = `${tenantId}/${folder}/${randomUUID()}.${ext}`;
    const url = await getSignedUrl(this.client, new PutObjectCommand({ Bucket: this.bucket, Key: key, ContentType: contentType }), { expiresIn: 600 });
    return { key, url, expiresIn: 600 };
  }

  async downloadUrl(key: string) {
    if (!this.client) return null;
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: key }), { expiresIn: 3600 });
  }
}

export const fileUrl = (fileId: string) => `/api/v1/files/${fileId}`;

@ApiTags('Files')
@ApiBearerAuth()
@Controller('files')
class FilesController {
  constructor(private readonly storage: StorageService) {}

  /** Serves a stored image to signed-in users of the same shop. File ids never change, so it caches well. */
  @Get(':id')
  @ApiProduces('image/jpeg', 'image/png', 'image/webp')
  async get(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Res() res: Response) {
    const f = await this.storage.read(user.tenantId, id);
    res.set({ 'content-type': f.mime, 'content-length': String(f.body.length), 'cache-control': 'private, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
    res.end(f.body);
  }
}

@Global()
@Module({ controllers: [FilesController], providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
