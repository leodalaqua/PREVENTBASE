import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { PasskeyController } from "./passkey.controller.js";
import { PasskeyService } from "./passkey.service.js";
import { UsersController } from "./users.controller.js";

@Module({
  controllers: [AuthController, PasskeyController, UsersController],
  providers: [AuthService, PasskeyService],
})
export class IdentityModule {}
