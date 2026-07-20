import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor
} from "@nestjs/common";
import { map } from "rxjs";

@Injectable()
export class ApiResponseInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler) {
    const requestId = context.switchToHttp().getRequest<{
      medicnRequestId?: string;
    }>().medicnRequestId;
    return next.handle().pipe(
      map((data) => {
        if (
          data &&
          typeof data === "object" &&
          "data" in data &&
          "meta" in data &&
          "error" in data
        ) {
          return data;
        }

        return {
          data,
          meta: requestId ? { requestId } : {},
          error: null
        };
      })
    );
  }
}
