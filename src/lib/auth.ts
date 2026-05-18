import type { User } from "@supabase/supabase-js";
import { ApiError } from "./errors";
import { createAnonClient } from "./supabase";

export function getBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) {
    throw new ApiError(401, "unauthorized", "Missing Supabase bearer token.");
  }
  return header.slice("Bearer ".length).trim();
}

export async function requireUser(request: Request): Promise<User> {
  const token = getBearerToken(request);
  const supabase = createAnonClient();
  const { data, error } = await supabase.auth.getUser(token);

  if (error || !data.user) {
    throw new ApiError(401, "unauthorized", "Invalid or expired Supabase bearer token.");
  }

  return data.user;
}
