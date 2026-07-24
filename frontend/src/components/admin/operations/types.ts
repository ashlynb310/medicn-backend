export type AdminOperationsListKind =
  | "payments"
  | "transfers"
  | "jobs"
  | "commands";

export interface AdminOperationFilterDraft {
  status: string;
  reversalStatus: string;
  bookingId: string;
  state: string;
  jobType: string;
  queueName: string;
  commandType: string;
  jobScope: "all" | "failed";
  createdFrom: string;
  createdTo: string;
}

export function initialAdminOperationFilterDraft(): AdminOperationFilterDraft {
  return {
    status: "any",
    reversalStatus: "any",
    bookingId: "",
    state: "any",
    jobType: "",
    queueName: "any",
    commandType: "any",
    jobScope: "all",
    createdFrom: "",
    createdTo: "",
  };
}
