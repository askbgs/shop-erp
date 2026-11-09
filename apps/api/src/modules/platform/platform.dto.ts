import { PartialType } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayUnique, IsArray, IsBoolean, IsEmail, IsEnum, IsInt, IsOptional, IsString, IsUUID, Length, Matches, Max, Min, MinLength,
} from 'class-validator';
import { DocType, TenantStatus } from '../../generated/prisma/client';
import { LK_PHONE, LK_PHONE_MSG } from '../auth/auth.dto';

export const SL_DISTRICTS = [
  'Ampara', 'Anuradhapura', 'Badulla', 'Batticaloa', 'Colombo', 'Galle', 'Gampaha', 'Hambantota', 'Jaffna', 'Kalutara',
  'Kandy', 'Kegalle', 'Kilinochchi', 'Kurunegala', 'Mannar', 'Matale', 'Matara', 'Monaragala', 'Mullaitivu', 'Nuwara Eliya',
  'Polonnaruwa', 'Puttalam', 'Ratnapura', 'Trincomalee', 'Vavuniya',
] as const;

// ── Tenant settings ──
export class UpdateTenantDto {
  @IsOptional() @IsString() @Length(2, 120) name?: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone?: string;
  @IsOptional() @IsEmail() email?: string;
}

export class UpdateSettingsDto {
  /** VAT rate in basis points, e.g. 1800 = 18% */
  @IsOptional() @IsInt() @Min(0) @Max(5000) vatRateBp?: number;
  @IsOptional() @IsBoolean() pricesIncludeVat?: boolean;
  @IsOptional() @IsBoolean() allowNegativeStock?: boolean;
  @IsOptional() @IsInt() @Min(0) @Max(3650) defaultWarrantyDays?: number;
  @IsOptional() @IsInt() @Min(0) @Max(3650) repairWarrantyDays?: number;
  @IsOptional() @IsString() repairTerms?: string;
  @IsOptional() @IsInt() receiptWidthMm?: number;
  @IsOptional() @IsInt() @Min(1) loyaltyEarnCentsPerPt?: number;
  @IsOptional() @IsInt() @Min(0) loyaltyPointValueCents?: number;
}

// ── Branches ──
export class CreateBranchDto {
  @Matches(/^[A-Z]{2,5}$/, { message: 'code must be 2–5 capital letters' }) code: string;
  @IsString() @Length(2, 80) name: string;
  @IsOptional() @IsString() address?: string;
  @IsOptional() @IsEnum(SL_DISTRICTS as unknown as object, { message: 'district must be one of the 25 Sri Lankan districts' }) district?: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone?: string;
  @IsOptional() @IsString() vatNumber?: string;
  @IsOptional() @IsString() invoiceHeader?: string;
  @IsOptional() @IsString() invoiceFooter?: string;
}

export class UpdateBranchDto extends PartialType(CreateBranchDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

export class UpdateNumberSeriesDto {
  @IsEnum(DocType) docType: DocType;
  @IsOptional() @Matches(/^[A-Z]{2,5}$/) prefix?: string;
  @IsOptional() @IsInt() @Min(1) nextNumber?: number;
  @IsOptional() @IsInt() @Min(3) @Max(10) padding?: number;
}

// ── Roles ──
export class CreateRoleDto {
  @IsString() @Length(2, 50) name: string;
  @IsOptional() @IsBoolean() allBranches?: boolean;
  /** Max discount in basis points (500 = 5%) */
  @IsOptional() @IsInt() @Min(0) @Max(10000) maxDiscountBp?: number;
  @IsOptional() @IsInt() @Min(0) maxRefundCents?: number;
  @IsArray() @ArrayUnique() @IsString({ each: true }) permissions: string[];
}
export class UpdateRoleDto extends PartialType(CreateRoleDto) {}

// ── Users ──
export class CreateUserDto {
  @IsString() @Length(2, 80) name: string;
  @IsEmail() email: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone?: string;
  @IsString() @MinLength(8) password: string;
  @IsUUID() roleId: string;
  @IsArray() @IsUUID('all', { each: true }) branchIds: string[];
  @IsOptional() @IsBoolean() isTechnician?: boolean;
  /** 4–6 digit PIN for quick cashier switching */
  @IsOptional() @Matches(/^\d{4,6}$/) pin?: string;
}

export class UpdateUserDto {
  @IsOptional() @IsString() @Length(2, 80) name?: string;
  @IsOptional() @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone?: string;
  @IsOptional() @IsUUID() roleId?: string;
  @IsOptional() @IsArray() @IsUUID('all', { each: true }) branchIds?: string[];
  @IsOptional() @IsBoolean() isTechnician?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
  @IsOptional() @Matches(/^\d{4,6}$/) pin?: string;
  @IsOptional() @IsString() @MinLength(8) password?: string;
}

// ── Vendor admin ──
export class AdminUpdateTenantDto {
  @IsOptional() @IsEnum(TenantStatus) status?: TenantStatus;
  @IsOptional() @IsString() planCode?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) branchCount?: number;
  /** Extend the trial or paid period by N days */
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) extendDays?: number;
}

export class AdminMarkPaidDto {
  @IsString() paymentRef: string;
}
