import { Module } from "@nestjs/common";
import { InventoryModule } from "../inventory/inventory.module.js";
import { DeliveryController } from "./delivery.controller.js";
import { DeliveryService } from "./delivery.service.js";
import { ReturnsController } from "./returns.controller.js";

@Module({
  imports: [InventoryModule],
  controllers: [DeliveryController, ReturnsController],
  providers: [DeliveryService],
})
export class DeliveryModule {}
