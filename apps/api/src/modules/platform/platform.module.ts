import { Module } from '@nestjs/common';
import { AdminController } from './admin.controller';
import { BranchesController } from './branches.controller';
import { TenantController } from './tenant.controller';
import { RolesController, UsersController } from './users.controller';

@Module({
  controllers: [TenantController, BranchesController, UsersController, RolesController, AdminController],
})
export class PlatformModule {}
