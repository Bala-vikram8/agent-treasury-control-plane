"use server";

import { redirect } from "next/navigation";
import {
  clearOperatorSession,
  createOperatorSession,
  verifyOperatorPassword,
} from "@/lib/auth";

export async function login(formData: FormData) {
  const password = String(formData.get("password") ?? "");

  if (!verifyOperatorPassword(password)) {
    redirect("/login?error=invalid");
  }

  await createOperatorSession();
  redirect("/");
}

export async function logout() {
  await clearOperatorSession();
  redirect("/login");
}
