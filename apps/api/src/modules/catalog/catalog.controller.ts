import { BadRequestException, Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query, UploadedFile, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBody, ApiConsumes } from '@nestjs/swagger';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { AuthUser, hasPermission } from '../../common/auth-user';
import { CurrentUser, RequireFeature, RequirePermissions } from '../../common/decorators';
import { normalizeImei } from '../../common/imei';
import { paged, paging } from '../../common/pagination';
import { FEATURES, PERMISSIONS } from '../../common/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../core/audit.service';
import { fileUrl, MAX_IMAGE_BYTES, StorageService } from '../storage/storage.module';

export const MAX_PRODUCT_IMAGES = 4;
const IMAGES = { orderBy: [{ sortOrder: 'asc' as const }, { createdAt: 'asc' as const }], select: { id: true, fileId: true } };
const withUrls = <T extends { images: { id: string; fileId: string }[] }>(p: T) => ({ ...p, images: p.images.map((i) => ({ id: i.id, url: fileUrl(i.fileId) })) });
import { CreateProductDto, NameDto, ProductQuery, UpdateProductDto, UpdateVariantDto, VariantDto } from './catalog.dto';

@ApiTags('Catalog')
@ApiBearerAuth()
@RequireFeature(FEATURES.INVENTORY)
@Controller('catalog')
export class CatalogController {
  constructor(private readonly prisma: PrismaService, private readonly audit: AuditService, private readonly storage: StorageService) {}

  // ── Categories & brands ──
  @Get('categories')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  categories(@CurrentUser() user: AuthUser) {
    return this.prisma.category.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('categories')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async createCategory(@CurrentUser() user: AuthUser, @Body() dto: NameDto) {
    await this.checkRefs(user.tenantId, dto.parentId);
    return this.prisma.category.create({ data: { tenantId: user.tenantId, name: dto.name, parentId: dto.parentId } });
  }

  @Patch('categories/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async renameCategory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: NameDto) {
    await this.prisma.category.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    await this.checkRefs(user.tenantId, dto.parentId);
    return this.prisma.category.update({ where: { id }, data: { name: dto.name, parentId: dto.parentId } });
  }

  @Get('brands')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  brands(@CurrentUser() user: AuthUser) {
    return this.prisma.brand.findMany({ where: { tenantId: user.tenantId }, orderBy: { name: 'asc' } });
  }

  @Post('brands')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  createBrand(@CurrentUser() user: AuthUser, @Body() dto: NameDto) {
    return this.prisma.brand.create({ data: { tenantId: user.tenantId, name: dto.name } });
  }

  // ── Products ──
  @Get('products')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  async products(@CurrentUser() user: AuthUser, @Query() q: ProductQuery) {
    const where = {
      tenantId: user.tenantId,
      categoryId: q.categoryId,
      brandId: q.brandId,
      trackingType: q.trackingType,
      ...(q.includeInactive ? {} : { isActive: true }),
      ...(q.q
        ? {
            OR: [
              { name: { contains: q.q, mode: 'insensitive' as const } },
              { model: { contains: q.q, mode: 'insensitive' as const } },
              { variants: { some: { OR: [{ sku: { contains: q.q, mode: 'insensitive' as const } }, { barcode: q.q }] } } },
            ],
          }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: { brand: true, category: true, variants: { where: { isActive: true }, orderBy: { name: 'asc' } }, images: IMAGES },
        orderBy: { name: 'asc' },
        ...paging(q),
      }),
      this.prisma.product.count({ where }),
    ]);
    return paged(items.map((p) => withUrls(this.hideCost(user, p))), total, q);
  }

  @Get('products/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  async product(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    const p = await this.prisma.product.findFirstOrThrow({
      where: { id, tenantId: user.tenantId },
      include: { brand: true, category: true, variants: { orderBy: { name: 'asc' } }, images: IMAGES },
    });
    return withUrls(this.hideCost(user, p));
  }

  @Post('products')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async createProduct(@CurrentUser() user: AuthUser, @Body() dto: CreateProductDto) {
    await this.checkRefs(user.tenantId, dto.categoryId, dto.brandId);
    if (dto.hasDualImei && dto.trackingType !== 'SERIAL') throw new BadRequestException('Dual IMEI only applies to SERIAL products');
    const { variants, ...data } = dto;
    return this.prisma.product.create({
      data: {
        ...data,
        tenantId: user.tenantId,
        variants: { create: variants.map((v) => ({ ...v, tenantId: user.tenantId })) },
      },
      include: { variants: true },
    });
  }

  @Patch('products/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async updateProduct(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto) {
    await this.prisma.product.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    await this.checkRefs(user.tenantId, dto.categoryId, dto.brandId);
    return this.prisma.product.update({ where: { id }, data: dto });
  }

  @Post('products/:id/variants')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async addVariant(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: VariantDto) {
    await this.prisma.product.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.prisma.productVariant.create({ data: { ...dto, productId: id, tenantId: user.tenantId } });
  }

  /** Price or cost changes need price.change; they are kept in price history and the audit log. */
  @Patch('variants/:id')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async updateVariant(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateVariantDto) {
    const before = await this.prisma.productVariant.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    const priceChanged =
      (dto.priceCents !== undefined && dto.priceCents !== before.priceCents) ||
      (dto.costCents !== undefined && dto.costCents !== before.costCents) ||
      (dto.minPriceCents !== undefined && dto.minPriceCents !== before.minPriceCents);
    if (priceChanged && !hasPermission(user, PERMISSIONS.PRICE_CHANGE)) {
      throw new BadRequestException('Changing prices needs the price.change permission');
    }
    return this.prisma.tx(async (tx) => {
      const after = await tx.productVariant.update({ where: { id }, data: dto });
      if (priceChanged) {
        await tx.priceHistory.create({ data: { variantId: id, costCents: after.costCents, priceCents: after.priceCents, changedBy: user.userId } });
        await this.audit.log({
          tenantId: user.tenantId, userId: user.userId, action: 'price.change', entity: 'ProductVariant', entityId: id,
          before: { priceCents: before.priceCents, costCents: before.costCents, minPriceCents: before.minPriceCents },
          after: { priceCents: after.priceCents, costCents: after.costCents, minPriceCents: after.minPriceCents },
        }, tx);
      }
      return after;
    });
  }

  @Get('variants/:id/price-history')
  @RequirePermissions(PERMISSIONS.PRICE_CHANGE)
  async priceHistory(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.productVariant.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    return this.prisma.priceHistory.findMany({ where: { variantId: id }, orderBy: { changedAt: 'desc' } });
  }

  @Delete('variants/:id')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async deactivateVariant(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.prisma.productVariant.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    await this.prisma.productVariant.update({ where: { id }, data: { isActive: false } });
  }

  // ── Product images ──
  /** Upload one photo (multipart field "file", JPEG/PNG/WebP, max 3 MB). The first photo becomes the cover. */
  @Post('products/:id/images')
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  @ApiConsumes('multipart/form-data')
  @ApiBody({ schema: { type: 'object', properties: { file: { type: 'string', format: 'binary' } } } })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: MAX_IMAGE_BYTES, files: 1 } }))
  async addImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @UploadedFile() file?: Express.Multer.File) {
    await this.prisma.product.findFirstOrThrow({ where: { id, tenantId: user.tenantId } });
    if (!file) throw new BadRequestException('Attach an image in the "file" field');
    const image = await this.prisma.tx(async (tx) => {
      const count = await tx.productImage.count({ where: { productId: id } });
      if (count >= MAX_PRODUCT_IMAGES) throw new BadRequestException(`A product can have up to ${MAX_PRODUCT_IMAGES} photos`);
      const last = await tx.productImage.findFirst({ where: { productId: id }, orderBy: { sortOrder: 'desc' } });
      const stored = await this.storage.saveImage(tx, user.tenantId, file.buffer, 'products');
      return tx.productImage.create({ data: { tenantId: user.tenantId, productId: id, fileId: stored.id, sortOrder: (last?.sortOrder ?? -1) + 1 } });
    });
    return { id: image.id, url: fileUrl(image.fileId) };
  }

  @Delete('products/:id/images/:imageId')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async removeImage(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    const img = await this.prisma.productImage.findFirstOrThrow({ where: { id: imageId, productId: id, tenantId: user.tenantId }, include: { file: { select: { r2Key: true } } } });
    await this.prisma.storedFile.delete({ where: { id: img.fileId } }); // cascades to the image row
    await this.storage.removeBlob(img.file.r2Key);
  }

  /** Make this photo the cover (shown in lists and at the POS). */
  @Post('products/:id/images/:imageId/cover')
  @HttpCode(204)
  @RequirePermissions(PERMISSIONS.CATALOG_MANAGE)
  async setCover(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string, @Param('imageId', ParseUUIDPipe) imageId: string) {
    await this.prisma.productImage.findFirstOrThrow({ where: { id: imageId, productId: id, tenantId: user.tenantId } });
    const all = await this.prisma.productImage.findMany({ where: { productId: id }, orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }] });
    const order = [imageId, ...all.map((i) => i.id).filter((x) => x !== imageId)];
    await this.prisma.$transaction(order.map((imgId, n) => this.prisma.productImage.update({ where: { id: imgId }, data: { sortOrder: n } })));
  }

  /**
   * POS scan lookup: one code that may be an IMEI, serial, barcode or SKU.
   * An IMEI/serial match returns the exact stock unit so the POS can sell that unit.
   */
  @Get('lookup')
  @RequirePermissions(PERMISSIONS.CATALOG_READ)
  async lookup(@CurrentUser() user: AuthUser, @Query('code') code: string, @Query('branchId') branchId?: string) {
    if (!code) throw new BadRequestException('code is required');
    const c = normalizeImei(code.trim());
    const unit = await this.prisma.stockUnit.findFirst({
      where: { tenantId: user.tenantId, OR: [{ imei1: c }, { imei2: c }, { serial: code.trim() }] },
      include: { variant: { include: { product: { include: { images: { ...IMAGES, take: 1 } } } } } },
    });
    if (unit) {
      return {
        match: 'UNIT' as const,
        unit: { ...unit, costCents: hasPermission(user, PERMISSIONS.STOCK_VIEW_COST) ? unit.costCents : undefined },
        imageUrl: unit.variant.product.images[0] ? fileUrl(unit.variant.product.images[0].fileId) : null,
        sellable: unit.status === 'IN_STOCK' && (!branchId || unit.branchId === branchId),
        priceCents: unit.priceCents ?? unit.variant.priceCents,
      };
    }
    const variant = await this.prisma.productVariant.findFirst({
      where: { tenantId: user.tenantId, isActive: true, OR: [{ barcode: code.trim() }, { sku: code.trim() }] },
      include: { product: { include: { images: { ...IMAGES, take: 1 } } }, balances: branchId ? { where: { branchId } } : false },
    });
    if (variant) {
      return {
        match: 'VARIANT' as const, variant: this.hideVariantCost(user, variant), priceCents: variant.priceCents,
        imageUrl: variant.product.images[0] ? fileUrl(variant.product.images[0].fileId) : null,
      };
    }
    return { match: 'NONE' as const };
  }

  private async checkRefs(tenantId: string, categoryId?: string, brandId?: string) {
    if (categoryId && !(await this.prisma.category.findFirst({ where: { id: categoryId, tenantId } }))) throw new BadRequestException('Category not found');
    if (brandId && !(await this.prisma.brand.findFirst({ where: { id: brandId, tenantId } }))) throw new BadRequestException('Brand not found');
  }

  private hideVariantCost<T extends { costCents: number }>(user: AuthUser, v: T): T {
    return hasPermission(user, PERMISSIONS.STOCK_VIEW_COST) ? v : { ...v, costCents: undefined as unknown as number };
  }

  private hideCost<T extends { variants: { costCents: number }[] }>(user: AuthUser, p: T): T {
    return { ...p, variants: p.variants.map((v) => this.hideVariantCost(user, v)) };
  }
}
