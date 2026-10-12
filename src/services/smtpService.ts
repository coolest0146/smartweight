import { invoke } from "@tauri-apps/api/core";

export async function sendOtpEmail(to: string, otp: string): Promise<void> {
  await invoke("send_approval_otp_email", { to, otp });
}

export async function sendOperatorPinOtpEmail(to: string, otp: string): Promise<void> {
  await invoke("send_operator_pin_otp_email", { to, otp });
}
