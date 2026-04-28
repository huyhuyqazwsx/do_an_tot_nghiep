export type ErrorDetails = Record<string, unknown> | unknown[] | undefined;

export interface StandardErrorResponse {
  statusCode: number;
  timestamp: string;
  path: string;
  message: string | string[];
  error: string;
  details?: ErrorDetails;
}
