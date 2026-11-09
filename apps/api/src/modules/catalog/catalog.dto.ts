import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsBoolean, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Min, ValidateNested,
} from 'class-validator';
import { TrackingType } from '../../generated/prisma/client';
import { PageQuery, QueryBool } from '../../common/pagination';

export class NameDto {
  @IsString() @Length(1, 80) name: string;
  @IsOptional() @IsUUID() parentId?: string;
}

export class VariantDto {
  @IsString() @Length(1, 60) sku: string;
  @IsOptional() @IsString() barcode?: string;
  /** e.g. "128GB Midnight" */
  @IsString() @Length(1, 120) name: string;
  /** { color, storage, ram, cpu } */
  @IsOptional() @IsObject() attributes?: Record<string, string>;
  @IsOptional() @IsInt() @Min(0) costCents?: number;
  @IsInt() @Min(0) priceCents: number;
  @IsOptional() @IsInt() @Min(0) wholesaleCents?: number;
  @IsOptional() @IsInt() @Min(0) minPriceCents?: number;
  @IsOptional() @IsInt() @Min(0) reorderLevel?: number;
}

export class UpdateVariantDto extends PartialType(VariantDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class CreateProductDto {
  @IsString() @Length(1, 160) name: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  /** SERIAL = IMEI/serial per unit (phones, laptops), QUANTITY = counted items, SERVICE = no stock */
  @IsEnum(TrackingType) trackingType: TrackingType;
  @IsOptional() @IsBoolean() hasDualImei?: boolean;
  @IsOptional() @IsInt() @Min(0) warrantyDays?: number;
  @IsOptional() @IsString() description?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => VariantDto) variants: VariantDto[];
}

export class UpdateProductDto {
  @IsOptional() @IsString() @Length(1, 160) name?: string;
  @IsOptional() @IsString() model?: string;
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsBoolean() hasDualImei?: boolean;
  @IsOptional() @IsInt() @Min(0) warrantyDays?: number;
  @IsOptional() @IsString() description?: string;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class ProductQuery extends PageQuery {
  @IsOptional() @IsUUID() categoryId?: string;
  @IsOptional() @IsUUID() brandId?: string;
  @IsOptional() @IsEnum(TrackingType) trackingType?: TrackingType;
  @IsOptional() @QueryBool() @IsBoolean() includeInactive?: boolean;
}
