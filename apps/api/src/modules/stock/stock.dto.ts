import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Min, NotEquals, ValidateNested,
} from 'class-validator';
import { StockUnitStatus, UnitCondition } from '../../generated/prisma/client';
import { PageQuery, QueryBool } from '../../common/pagination';

export class ReceiptUnitDto {
  @IsOptional() @IsString() imei1?: string;
  @IsOptional() @IsString() imei2?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsEnum(UnitCondition) condition?: UnitCondition;
  /** Selling price for this unit if different from the variant (e.g. used grade) */
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
}

export class ReceiptLineDto {
  @IsUUID() variantId: string;
  @IsInt() @Min(1) qty: number;
  @IsInt() @Min(0) unitCostCents: number;
  /** Required for SERIAL products: one entry per unit (qty must match) */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => ReceiptUnitDto) units?: ReceiptUnitDto[];
}

export class CreateReceiptDto {
  @IsUUID() branchId: string;
  @IsOptional() @IsString() supplierName?: string;
  /** Supplier invoice / delivery note number */
  @IsOptional() @IsString() reference?: string;
  @IsOptional() @IsString() note?: string;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => ReceiptLineDto) lines: ReceiptLineDto[];
}

export class AdjustmentDto {
  @IsUUID() branchId: string;
  @IsUUID() variantId: string;
  /** Signed quantity for QUANTITY items: +3 found, -2 damaged. Ignored when stockUnitId is given. */
  @IsOptional() @IsInt() @NotEquals(0) qty?: number;
  /** Serialized unit to write off (or restore if WRITTEN_OFF) */
  @IsOptional() @IsUUID() stockUnitId?: string;
  @IsString() @Length(3, 200) reason: string;
}

export class UpdateUnitDto {
  @IsOptional() @IsEnum(UnitCondition) condition?: UnitCondition;
  @IsOptional() @IsInt() @Min(0) priceCents?: number;
}

export class UnitQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsEnum(StockUnitStatus) status?: StockUnitStatus;
}

export class BalanceQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  /** Only rows at or below the reorder level */
  @IsOptional() @QueryBool() lowStock?: boolean;
}

export class MovementQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() variantId?: string;
  @IsOptional() @IsUUID() stockUnitId?: string;
}

export class BranchPageQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
}
