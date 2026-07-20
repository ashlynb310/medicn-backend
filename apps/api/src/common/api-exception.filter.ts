import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus
} from "@nestjs/common";

type ApiErrorCode =
  | "ACCOUNT_DISABLED"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "VALIDATION_ERROR"
  | "INVALID_SUPABASE_TOKEN"
  | "USER_NOT_SYNCED"
  | "EMAIL_NOT_VERIFIED"
  | "INQUIRY_NOT_AVAILABLE"
  | "INQUIRY_ALREADY_OPEN"
  | "INQUIRY_CLOSED"
  | "CONTACT_INFORMATION_NOT_ALLOWED"
  | "CONNECT_NOT_CONFIGURED"
  | "CONNECT_ONBOARDING_REQUIRED"
  | "HOST_PAYOUT_ACCOUNT_NOT_READY"
  | "IDENTITY_VERIFICATION_EXPIRED"
  | "IDENTITY_VERIFICATION_PENDING"
  | "IDENTITY_VERIFICATION_REJECTED"
  | "IDENTITY_VERIFICATION_REQUIRED"
  | "HEALTHCARE_SUBMISSION_ACTIVE"
  | "HEALTHCARE_SUBMISSION_NOT_EDITABLE"
  | "HEALTHCARE_EVIDENCE_LIMIT_REACHED"
  | "HEALTHCARE_EVIDENCE_NOT_READY"
  | "HEALTHCARE_DECISION_CONFLICT"
  | "HEALTHCARE_DECISION_FINAL"
  | "LISTING_LOCATION_CHANGE_BLOCKED"
  | "LISTING_ARCHIVE_BLOCKED_BY_ACTIVE_BOOKINGS"
  | "LISTING_LOCATION_INVALID"
  | "LISTING_LOCATION_NOT_READY"
  | "BOOKING_NOT_AVAILABLE"
  | "BOOKING_DATE_RANGE_TOO_LARGE"
  | "AVAILABILITY_RANGE_INVALID"
  | "AVAILABILITY_CONFLICTS_WITH_RESERVATION"
  | "AVAILABILITY_DEDICATED_ENDPOINT_REQUIRED"
  | "CALENDAR_RANGE_TOO_LARGE"
  | "LISTING_TIMEZONE_INVALID"
  | "BOOKING_CANCELLATION_NOT_ALLOWED"
  | "PAID_CANCELLATION_POLICY_UNAVAILABLE"
  | "CANCELLATION_ALREADY_IN_PROGRESS"
  | "PAYMENT_STATE_CHANGED"
  | "PAYMENT_PROVIDER_UNAVAILABLE"
  | "BOOKING_STATUS_NOT_ALLOWED"
  | "LISTING_STATUS_NOT_ALLOWED"
  | "MEDIA_INPUT_TOO_LARGE"
  | "MEDIA_NOT_CONFIGURED"
  | "MEDIA_PROCESSING_REQUIRED"
  | "MEDIA_STORAGE_UNAVAILABLE"
  | "MEDIA_UPLOAD_EXPIRED"
  | "MEDIA_UPLOAD_LIMIT_REACHED"
  | "MEDIA_UPLOAD_OBJECT_MISSING"
  | "METRICS_UNAUTHORIZED"
  | "PAYMENT_FAILED"
  | "WEBHOOK_SIGNATURE_INVALID"
  | "INVALID_VERIFF_SIGNATURE"
  | "INVALID_WEBHOOK_PAYLOAD"
  | "PAYLOAD_TOO_LARGE"
  | "RATE_LIMIT_EXCEEDED"
  | "RATE_LIMIT_UNAVAILABLE"
  | "TRANSFER_ALREADY_RELEASED"
  | "TRANSFER_FAILED"
  | "TRANSFER_NOT_ELIGIBLE"
  | "VERIFF_NOT_CONFIGURED"
  | "VERIFF_PROVIDER_UNAVAILABLE"
  | "WEBHOOK_UNAUTHORIZED"
  | "INTERNAL_SERVER_ERROR";

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const response = context.getResponse();
    const request =
      typeof context.getRequest === "function"
        ? context.getRequest<{ medicnRequestId?: string }>()
        : undefined;

    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : this.statusFromUnknown(exception);

    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;

    const error = this.toApiError(status, body);

    response.status(status).json({
      data: null,
      meta: request?.medicnRequestId
        ? { requestId: request.medicnRequestId }
        : {},
      error
    });
  }

  private toApiError(status: number, body: unknown) {
    if (typeof body === "object" && body !== null) {
      const nestedError = (body as { error?: unknown }).error;
      if (this.isStructuredApiError(nestedError)) {
        return nestedError;
      }

      if (this.isStructuredApiError(body)) {
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
      case HttpStatus.PAYLOAD_TOO_LARGE:
        return "PAYLOAD_TOO_LARGE";
      default:
        return "INTERNAL_SERVER_ERROR";
    }
  }

  private statusFromUnknown(exception: unknown) {
    if (typeof exception !== "object" || exception === null) {
      return HttpStatus.INTERNAL_SERVER_ERROR;
    }
    const status = (exception as { status?: unknown }).status;
    return status === HttpStatus.BAD_REQUEST ||
      status === HttpStatus.PAYLOAD_TOO_LARGE
      ? status
      : HttpStatus.INTERNAL_SERVER_ERROR;
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

  private isStructuredApiError(
    value: unknown
  ): value is { code: string; message: string; details?: unknown } {
    return (
      typeof value === "object" &&
      value !== null &&
      "code" in value &&
      typeof value.code === "string" &&
      "message" in value &&
      typeof value.message === "string"
    );
  }
}
