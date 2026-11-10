import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth-user';
import { AllowWithTemporaryPassword, ClientIp, CurrentUser, Public } from '../../common/decorators';
import { ChangePasswordDto, ForgotPasswordDto, LoginDto, PinSwitchDto, RefreshDto, RegisterDto, ResetPasswordDto } from './auth.dto';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** Self sign-up for a new shop (starts a free trial). */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register')
  register(@Body() dto: RegisterDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.register(dto, { ip, userAgent: ua });
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('login')
  login(@Body() dto: LoginDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.login(dto.email, dto.password, { ip, userAgent: ua });
  }

  @Public()
  @HttpCode(200)
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.refresh(dto.refreshToken, { ip, userAgent: ua });
  }

  @Public()
  @HttpCode(204)
  @Post('logout')
  async logout(@Body() dto: RefreshDto) {
    await this.auth.logout(dto.refreshToken);
  }

  @AllowWithTemporaryPassword()
  @ApiBearerAuth()
  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return this.auth.me(user);
  }

  /** Switch the signed-in cashier on a shared POS using a PIN. */
  @ApiBearerAuth()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('pin-switch')
  pinSwitch(@CurrentUser() user: AuthUser, @Body() dto: PinSwitchDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.pinSwitch(user, dto.userId, dto.pin, { ip, userAgent: ua });
  }

  /** Change your own password. Returns new tokens for this session; other sessions are signed out. */
  @AllowWithTemporaryPassword()
  @ApiBearerAuth()
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    return this.auth.changePassword(user, dto.currentPassword, dto.newPassword, { ip, userAgent: ua });
  }

  /** Sends a 6-digit reset code by SMS to the account's mobile. Always returns 202. */
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(202)
  @Post('forgot-password')
  async forgotPassword(@Body() dto: ForgotPasswordDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    await this.auth.forgotPassword(dto.email, { ip, userAgent: ua });
    return { message: 'If this email belongs to an account with a mobile number, a 6-digit code has been sent by SMS.' };
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(204)
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordDto, @ClientIp() ip: string, @Headers('user-agent') ua: string) {
    await this.auth.resetPassword(dto.email, dto.code, dto.newPassword, { ip, userAgent: ua });
  }

  @AllowWithTemporaryPassword()
  @ApiBearerAuth()
  @Get('sessions')
  sessions(@CurrentUser() user: AuthUser) {
    return this.auth.sessions(user);
  }

  @ApiBearerAuth()
  @HttpCode(204)
  @Delete('sessions/:id')
  async revoke(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.auth.revokeSession(user, id);
  }
}
