import { NextResponse } from "next/server";
import { ApiError, isApiError } from "./errors";

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json({ ok: true, data }, init);
}

export function created<T>(data: T) {
  return ok(data, { status: 201 });
}

export function handleApiError(error: unknown) {
  if (isApiError(error)) {
    return NextResponse.json(
      { ok: false, error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status }
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error";
  return NextResponse.json(
    { ok: false, error: { code: "internal_error", message } },
    { status: 500 }
  );
}

export async function readJson<T>(request: Request): Promise<T> {
  try {
    return (await request.json()) as T;
  } catch {
    throw new ApiError(400, "invalid_json", "Request body must be valid JSON.");
  }
}

export function requireCronAuth(request: Request, cronSecret: string) {
  const header = request.headers.get("authorization");
  if (header !== `Bearer ${cronSecret}`) {
    throw new ApiError(401, "unauthorized", "Missing or invalid worker authorization.");
  }
}
