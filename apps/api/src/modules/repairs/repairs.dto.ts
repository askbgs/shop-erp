import { Type } from 'class-transformer';
import {
  IsArray, IsBoolean, IsDateString, IsEnum, IsIn, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Min, ValidateNested,
} from 'class-validator';
import { RepairStatus } from '../../generated/prisma/client';
import { PageQuery } from '../../common/pagination';
import { LK_PHONE, LK_PHONE_MSG } from '../auth/auth.dto';
import { PaymentInputDto, QuickCustomerDto } from '../sales/sales.dto';

export class CreateRepairDto {
  @IsUUID() branchId: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @ValidateNested() @Type(() => QuickCustomerDto) customer?: QuickCustomerDto;
  @IsOptional() @IsString() deviceBrand?: string;
  @IsString() @Length(1, 120) deviceModel: string;
  @IsOptional() @IsString() imei?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsString() color?: string;
  @IsString() @Length(3, 1000) reportedFault: string;
  /** e.g. ["SIM tray", "Back cover", "Charger"] */
  @IsOptional() @IsArray() @IsString({ each: true }) accessories?: string[];
  @IsOptional() @IsString() conditionNotes?: string;
  @IsOptional() @IsBoolean() powersOn?: boolean;
  /** Screen lock PIN or pattern; stored encrypted */
  @IsOptional() @IsString() @Length(1, 60) passcode?: string;
  @IsOptional() @IsInt() @Min(0) estimateCents?: number;
  @IsOptional() @IsDateString() promisedAt?: string;
  @IsOptional() @IsUUID() technicianId?: string;
  /** Earlier job this is a warranty comeback for */
  @IsOptional() @IsUUID() parentJobId?: string;
  /** Advance payment taken at intake */
  @IsOptional() @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) advance?: PaymentInputDto[];
}

export class UpdateRepairDto {
  @IsOptional() @IsString() deviceBrand?: string;
  @IsOptional() @IsString() @Length(1, 120) deviceModel?: string;
  @IsOptional() @IsString() imei?: string;
  @IsOptional() @IsString() serial?: string;
  @IsOptional() @IsString() color?: string;
  @IsOptional() @IsString() conditionNotes?: string;
  @IsOptional() @IsString() diagnosis?: string;
  @IsOptional() @IsInt() @Min(0) estimateCents?: number;
  @IsOptional() @IsInt() @Min(0) labourCents?: number;
  @IsOptional() @IsDateString() promisedAt?: string;
}

export class ChangeStatusDto {
  @IsEnum(RepairStatus) status: RepairStatus;
  @IsOptional() @IsString() @Length(0, 500) note?: string;
}

export class AssignDto {
  @IsUUID() technicianId: string;
}

export class AddPartDto {
  @IsOptional() @IsUUID() variantId?: string;
  /** Scan a serialized spare part */
  @IsOptional() @IsString() imei?: string;
  @IsInt() @Min(1) qty: number;
  /** Price charged to the customer; defaults to the variant price */
  @IsOptional() @IsInt() @Min(0) unitPriceCents?: number;
}

export class DeliverDto {
  /** Final labour charge (or diagnosis fee for rejected / not-repairable jobs) */
  @IsOptional() @IsInt() @Min(0) labourCents?: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentInputDto) payments: PaymentInputDto[];
  @IsOptional() @IsString() note?: string;
}

export class PhotoUploadDto {
  @IsIn(['image/jpeg', 'image/png', 'image/webp']) contentType: string;
}

export class PhotoRegisterDto {
  @IsString() key: string;
  @IsOptional() @IsString() caption?: string;
  @IsOptional() @IsIn(['INTAKE', 'REPAIR', 'DELIVERY']) stage?: string;
}

export class RepairQuery extends PageQuery {
  @IsOptional() @IsUUID() branchId?: string;
  @IsOptional() @IsEnum(RepairStatus) status?: RepairStatus;
  @IsOptional() @IsUUID() technicianId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  /** open = every status before delivery */
  @IsOptional() @IsIn(['open', 'closed']) state?: 'open' | 'closed';
}

export class TrackQuery {
  /** Tracking code printed on the job card and sent by SMS */
  @IsString() @Length(6, 20) code: string;
  @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone: string;
}
