import { Body, Controller, Delete, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { AuthUser } from '../../common/auth-user';
import { ClientIp, CurrentUser, Public } from '../../common/decorators';
import { ChangePasswordDto, LoginDto, PinSwitchDto, RefreshDto, RegisterDto } from './auth.dto';
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

  @ApiBearerAuth()
  @HttpCode(204)
  @Post('change-password')
  async changePassword(@CurrentUser() user: AuthUser, @Body() dto: ChangePasswordDto) {
    await this.auth.changePassword(user, dto.currentPassword, dto.newPassword);
  }

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
