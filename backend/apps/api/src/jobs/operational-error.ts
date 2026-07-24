export class OperationalError extends Error {
  constructor(
    public readonly category: string,
    public readonly safeMessage: string,
    public readonly retryable: boolean,
    options?: ErrorOptions
  ) {
    super(safeMessage, options);
  }
}

export function classifyOperationalError(error: unknown) {
  if (error instanceof OperationalError) {
    return {
      category: error.category.slice(0, 100),
      message: error.safeMessage.slice(0, 500),
      retryable: error.retryable
    };
  }

  return {
    category: "job_processing_failed",
    message: "The background job did not complete.",
    retryable: true
  };
}
