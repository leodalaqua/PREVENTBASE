import { Module } from "@nestjs/common";
import { AuthController } from "./auth.controller.js";
import { AuthService } from "./auth.service.js";
import { DevicesController } from "./devices.controller.js";

@Module({
  controllers: [AuthController, DevicesController],
  providers: [AuthService],
})
export class IdentityModule {}
