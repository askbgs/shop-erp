import { IsEmail, IsEnum, IsOptional, IsString, IsUUID, Length, Matches, MinLength } from 'class-validator';
import { BusinessType } from '../../generated/prisma/client';

export const LK_PHONE = /^\+94\d{9}$/;
export const LK_PHONE_MSG = 'phone must be in +94XXXXXXXXX format';

export class RegisterDto {
  /** Shop / company name */
  @IsString() @Length(2, 120) shopName: string;
  @IsEnum(BusinessType) businessType: BusinessType;
  @IsString() @Length(2, 80) ownerName: string;
  @IsEmail() email: string;
  @Matches(LK_PHONE, { message: LK_PHONE_MSG }) phone: string;
  @IsString() @MinLength(8) password: string;
  /** First branch name, e.g. "Trincomalee Main" */
  @IsString() @Length(2, 80) branchName: string;
  /** 2–5 letter branch code used in document numbers, e.g. TRI */
  @Matches(/^[A-Z]{2,5}$/, { message: 'branchCode must be 2–5 capital letters' }) branchCode: string;
  @IsOptional() @IsString() district?: string;
  /** Plan code: REPAIR_ONLY, POS_REPAIRS or FULL (defaults to POS_REPAIRS) */
  @IsOptional() @IsString() planCode?: string;
}

export class LoginDto {
  @IsEmail() email: string;
  @IsString() password: string;
}

export class RefreshDto {
  @IsString() refreshToken: string;
}

export class PinSwitchDto {
  @IsUUID() userId: string;
  @Matches(/^\d{4,6}$/, { message: 'pin must be 4–6 digits' }) pin: string;
}

export class ChangePasswordDto {
  @IsString() currentPassword: string;
  @IsString() @MinLength(8) newPassword: string;
}

export class ForgotPasswordDto {
  @IsEmail() email: string;
}

export class ResetPasswordDto {
  @IsEmail() email: string;
  @Matches(/^\d{6}$/, { message: 'code must be the 6 digits from the SMS' }) code: string;
  @IsString() @MinLength(8) newPassword: string;
}
