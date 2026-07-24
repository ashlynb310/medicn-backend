import {
  CanActivate,
  ExecutionContext,
  Injectable
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { AuthService } from "../../auth/auth.service";
import {
  ROUTE_AUTH_MODE,
  type RouteAuthMode
} from "./route-auth.decorator";

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService
  ) {}

  canActivate(context: ExecutionContext) {
    if (context.getType() !== "http") return true;

    const mode =
      this.reflector.getAllAndOverride<RouteAuthMode>(ROUTE_AUTH_MODE, [
        context.getHandler(),
        context.getClass()
      ]) ?? "protected";
    if (mode === "public") return true;

    const request = context.switchToHttp().getRequest<{
      headers: { authorization?: string };
    }>();
    const authorization = request.headers.authorization;
    if (mode === "optional" && !authorization) return true;

    this.auth.extractBearerToken(authorization);
    return true;
  }
}
