import { Body, Controller, Delete, Get, HttpCode, Param, Post } from "@nestjs/common";
import { loginSchema, refreshSchema } from "@preventbase/contracts";
import { z } from "zod";
import { Public } from "../../core/auth.guard.js";
import { zod } from "../../core/http.js";
import { AuthService } from "./auth.service.js";

const codeSchema = z.object({ code: z.string().min(6).max(10) });
const ssoSchema = z
  .object({
    ticket: z.string().trim().min(1).max(300).optional(),
    mfaToken: z.string().trim().min(1).max(100).optional(),
    mfaCode: z.string().trim().max(10).optional(),
  })
  .refine((b) => b.ticket || b.mfaToken, { message: "Informe o ticket do login único" });

@Controller("auth")
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get("sso-config")
  ssoConfig() {
    return this.auth.ssoConfig();
  }

  @Public()
  @Post("sso")
  @HttpCode(200)
  sso(@Body(zod(ssoSchema)) body: z.infer<typeof ssoSchema>) {
    return this.auth.loginSso(body);
  }

  @Public()
  @Post("login")
  @HttpCode(200)
  login(@Body(zod(loginSchema)) body: z.infer<typeof loginSchema>) {
    return this.auth.login(body.email, body.password, body.mfaCode);
  }

  @Public()
  @Post("refresh")
  @HttpCode(200)
  refresh(@Body(zod(refreshSchema)) body: z.infer<typeof refreshSchema>) {
    return this.auth.refresh(body.refreshToken);
  }

  @Post("logout")
  @HttpCode(204)
  logout() {
    return this.auth.logout();
  }

  @Get("me")
  me() {
    return this.auth.me();
  }

  @Get("sessions")
  sessions() {
    return this.auth.sessions();
  }

  @Delete("sessions/:id")
  @HttpCode(204)
  revoke(@Param("id") id: string) {
    return this.auth.revokeSession(id);
  }

  @Post("mfa/setup")
  mfaSetup() {
    return this.auth.mfaSetup();
  }

  @Post("mfa/enable")
  @HttpCode(204)
  mfaEnable(@Body(zod(codeSchema)) body: z.infer<typeof codeSchema>) {
    return this.auth.mfaEnable(body.code);
  }

  @Post("mfa/disable")
  @HttpCode(204)
  mfaDisable(@Body(zod(codeSchema)) body: z.infer<typeof codeSchema>) {
    return this.auth.mfaDisable(body.code);
  }
}
