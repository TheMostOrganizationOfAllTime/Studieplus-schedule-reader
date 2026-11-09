import { login, loginFailureMessage, type LoginFailure } from "../lib/unilogin";

export type { LoginFailure };

export type ConfirmLoginResult =
  | { ok: true; token: string }
  | { ok: false; reason: LoginFailure; message: string };

export async function confirmLogin(
  username: string,
  password: string,
): Promise<ConfirmLoginResult> {
  const result = await login(username, password);
  if (result.ok) return result;
  return {
    ok: false,
    reason: result.reason,
    message: loginFailureMessage[result.reason],
  };
}
