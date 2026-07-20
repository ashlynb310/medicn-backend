import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { MediaModule } from "../media/media.module";
import { UsersController } from "./users.controller";
import { UsersService } from "./users.service";

@Module({
  imports: [AuthModule, PrismaModule, MediaModule],
  controllers: [UsersController],
  providers: [UsersService]
})
export class UsersModule {}
