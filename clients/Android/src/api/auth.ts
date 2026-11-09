import { login } from "../lib/unilogin";

/** Returns the utoken, or null if the login failed. */
export async function confirmLogin(
  username: string,
  password: string,
): Promise<string | null> {
  try {
    return await login(username, password);
  } catch {
    return null;
  }
}
