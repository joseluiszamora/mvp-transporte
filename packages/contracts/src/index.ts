export interface HealthResponse {
  status: "ok";
  service: "api";
  timestamp: string;
}

export interface ReadinessResponse {
  status: "ready" | "not_ready";
}

export interface ApiErrorResponse {
  error: {
    code: string;
    message: string;
    requestId: string;
  };
}
