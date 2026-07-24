export const BOOKING_COMPLETION_EMAIL_JOB = "send_booking_completion_email";

export interface BookingCompletionEmailPayload {
  bookingId: string;
  recipientUserId: string;
}
