import { Type } from 'class-transformer';
import {
  ArrayMinSize, IsArray, IsEnum, IsInt, IsObject, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested,
} from 'class-validator';
import { PaymentMethod, SaleStatus } from '../../generated/prisma/client';
import { PageQuery } from '../../common/pagination';
import { LK_PHONE, LK_PHONE_MSG } from '../auth/auth.dto';

export class QuickCustomerDto {
  @IsString() @Length(1, 120) name: string;
  @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone: string;
}

export class SaleLineDto {
  /** For quantity items and services. Not needed when imei / stockUnitId is given. */
  @IsOptional() @IsUUID() variantId?: string;
  /** Exact serialized unit to sell */
  @IsOptional() @IsUUID() stockUnitId?: string;
  /** Scanned IMEI or serial number */
  @IsOptional() @IsString() imei?: string;
  @IsInt() @Min(1) qty: number;
  /** Defaults to the unit or variant selling price */
  @IsOptional() @IsInt() @Min(0) unitPriceCents?: number;
  @IsOptional() @IsInt() @Min(0) discountCents?: number;
  @IsOptional() @IsString() @Length(1, 200) description?: string;
}

export class PaymentInputDto {
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsInt() @Min(1) amountCents: number;
  /** Card approval code, transfer reference, cheque number… */
  @IsOptional() @IsString() reference?: string;
}

export class CreateSaleDto {
  @IsUUID() branchId: string;
  @IsOptional() @IsUUID() customerId?: string;
  /** Quick-add / reuse a customer by phone number */
  @IsOptional() @ValidateNested() @Type(() => QuickCustomerDto) customer?: QuickCustomerDto;
  @IsArray() @ArrayMinSize(1) @ValidateNested({ each: true }) @Type(() => SaleLineDto) lines: SaleLineDto[];
  @IsOptional() @IsInt() @Min(0) billDiscountCents?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments: PaymentInputDto[];
  @IsOptional() @IsString() @Length(0, 500) note?: string;
  /** Idempotency key from the POS (offline sync): sending the same key twice returns the first invoice */
  @IsOptional() @IsString() @Length(8, 80) clientRef?: string;
}

export class VoidSaleDto {
  @IsString() @Length(3, 300) reason: string;
}

export class SaleQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsEnum(SaleStatus) status?: SaleStatus;
  /** YYYY-MM-DD (shop local date), inclusive */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  /** YYYY-MM-DD (shop local date), inclusive */
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}

export class HoldBillDto {
  @IsUUID() branchId: string;
  @IsOptional() @IsString() @Length(1, 80) label?: string;
  /** The cart as the POS holds it */
  @IsObject() payload: Record<string, unknown>;
}

export class CollectPaymentDto {
  @IsOptional() @IsUUID() invoiceId?: string;
  @IsOptional() @IsUUID() repairJobId?: string;
  @IsEnum(PaymentMethod) method: PaymentMethod;
  @IsInt() @Min(1) amountCents: number;
  @IsOptional() @IsString() reference?: string;
}

export class PaymentQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsEnum(PaymentMethod) method?: PaymentMethod;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) from?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) to?: string;
}
