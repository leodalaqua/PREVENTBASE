import { type MiddlewareConsumer, Module, type NestModule } from "@nestjs/common";
import { CoreModule } from "./core/core.module.js";
import { ContextMiddleware } from "./core/http.js";
import { BiometricController } from "./modules/biometric/biometric.controller.js";
import { DeliveryModule } from "./modules/delivery/delivery.module.js";
import { DocumentsController } from "./modules/documents/documents.controller.js";
import { CaController } from "./modules/epi/ca.controller.js";
import { EpiController } from "./modules/epi/epi.controller.js";
import { IdentityModule } from "./modules/identity/identity.module.js";
import { InventoryModule } from "./modules/inventory/inventory.module.js";
import { OrganizationController } from "./modules/organization/organization.controller.js";
import { EmployeesController } from "./modules/people/employees.controller.js";
import { PlatformController } from "./modules/platform/platform.controller.js";
import { ReportsController } from "./modules/reporting/reports.controller.js";

/** Modular monolith (§85/§86): módulos de domínio separados; biometria fora do processo. */
@Module({
  imports: [CoreModule, IdentityModule, InventoryModule, DeliveryModule],
  controllers: [OrganizationController, EmployeesController, EpiController, CaController, BiometricController, DocumentsController, ReportsController, PlatformController],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(ContextMiddleware).forRoutes("{*path}");
  }
}
