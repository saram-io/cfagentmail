export interface ClientOptions {
  apiKey?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export interface RequestOptions {
  headers?: Record<string, string>;
}

export interface ApiError {
  code: string;
  message: string;
}

export interface ApiResponse<T> {
  data?: T;
  error?: ApiError;
}
