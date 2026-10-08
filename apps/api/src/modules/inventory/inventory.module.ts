import { Module } from "@nestjs/common";
import { InventoryCountController } from "./inventory-count.controller.js";
import { StockController } from "./stock.controller.js";
import { StockService } from "./stock.service.js";

@Module({
  controllers: [StockController, InventoryCountController],
  providers: [StockService],
  exports: [StockService],
})
export class InventoryModule {}
