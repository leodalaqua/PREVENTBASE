import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { z } from "zod";
import { Public } from "../../core/auth.guard.js";
import { zod } from "../../core/http.js";
import { PasskeyService } from "./passkey.service.js";

const verifySchema = z.object({ response: z.record(z.unknown()), deviceName: z.string().max(80).optional() });

@Controller("auth/passkey")
export class PasskeyController {
  constructor(private readonly passkeys: PasskeyService) {}

  @Public()
  @Post("login/options")
  @HttpCode(200)
  loginOptions() {
    return this.passkeys.loginOptions();
  }

  @Public()
  @Post("login/verify")
  @HttpCode(200)
  loginVerify(@Body(zod(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.passkeys.loginVerify(body.response);
  }

  @Get()
  list() {
    return this.passkeys.list();
  }

  @Post("register/options")
  @HttpCode(200)
  registerOptions() {
    return this.passkeys.registerOptions();
  }

  @Post("register/verify")
  @HttpCode(200)
  registerVerify(@Body(zod(verifySchema)) body: z.infer<typeof verifySchema>) {
    return this.passkeys.registerVerify(body.response, body.deviceName);
  }

  @Delete(":id")
  remove(@Param("id") id: string) {
    return this.passkeys.remove(id);
  }
}
