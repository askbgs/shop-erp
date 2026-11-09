import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Global, Injectable, Module, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';

/** Cloudflare R2 (S3-compatible). The browser uploads straight to R2 with a presigned URL. */
@Injectable()
export class StorageService {
  private client?: S3Client;
  private bucket?: string;

  constructor(config: ConfigService) {
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

@Global()
@Module({ providers: [StorageService], exports: [StorageService] })
export class StorageModule {}
