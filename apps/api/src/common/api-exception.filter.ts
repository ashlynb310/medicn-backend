import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";

type ApiErrorCode =
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_SUPABASE_TOKEN"
  | "USER_NOT_SYNCED"
  | "EMAIL_NOT_VERIFIED"
  | "INTERNAL_SERVER_ERROR";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse();

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const error = this.toApiError(status, body);

    response.status(status).json({
      data: null,
      meta: {},
      error
    });
  }

  private toApiError(status: number, body: unknown) {
    if (typeof body === "object" && body !== null) {
      if ("error" in body) {
        return (body as { error: unknown }).error;
      }

      if ("code" in body && "message" in body) {
        return body;
      }
    }

    return {
      code: this.defaultCode(status),
      message: this.defaultMessage(status),
      details: this.detailsFromBody(body)
    };
  }

  private defaultCode(status: number): ApiErrorCode {
    switch (status) {
      case HttpStatus.UNAUTHORIZED:
        return "UNAUTHORIZED";
      case HttpStatus.FORBIDDEN:
        return "FORBIDDEN";
      case HttpStatus.NOT_FOUND:
        return "NOT_FOUND";
      case HttpStatus.BAD_REQUEST:
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return "VALIDATION_ERROR";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }

  private defaultMessage(status: number) {
    if (status >= 500) {
      return "An unexpected server error occurred.";
    }

    return "The request could not be completed.";
  }

  private detailsFromBody(body: unknown) {
    return typeof body === "object" && body !== null ? body : {};
  }
}
