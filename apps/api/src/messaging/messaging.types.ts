import type { UserRole } from "@prisma/client";

export const MESSAGING_NOTIFICATION_EMAIL_JOB =
  "send_messaging_notification_email";

export interface MessagingNotificationEmailPayload {
  inquiryId: string;
  messageId: string;
  recipientUserId: string;
  template: "inquiry_new_message";
}

export interface MessagingSocketUser {
  id: string;
  roles: UserRole[];
  tokenExpiresAt: number;
}

export type MessagingRealtimeEvent =
  | {
      name: "message.created";
      rooms: string[];
      payload: {
        eventId: string;
        inquiryId: string;
        messageId: string;
        sequence: number;
        createdAt: string;
      };
    }
  | {
      name: "inquiry.updated";
      rooms: string[];
      payload: {
        eventId: string;
        inquiryId: string;
        status: "open" | "closed";
        lastSequence: number;
        lastMessageAt: string | null;
        updatedAt: string;
      };
    }
  | {
      name: "inquiry.closed";
      rooms: string[];
      payload: {
        eventId: string;
        inquiryId: string;
        status: "closed";
        closedAt: string;
      };
    }
  | {
      name: "unread.changed";
      rooms: string[];
      payload: {
        eventId: string;
        inquiryId: string;
        userId: string;
        updatedAt: string;
        lastReadSequence?: number;
        unreadCount?: number;
      };
    };

export const inquiryRoom = (inquiryId: string) => `inquiry:${inquiryId}`;
export const userRoom = (userId: string) => `user:${userId}`;
