import { translate } from "@/lib/i18n";

/**
 * An error with an HTTP status and a message that is safe to show to the user. The message is a plain
 * English text with `{placeholders}` filled from `vars`; errorResponse() translates it for the reader.
 */
export class HttpError extends Error {
  /** The English text before its placeholders are filled: the key it's translated by. */
  readonly text: string;

  constructor(
    public status: number,
    message: string,
    public code?: string,
    public vars?: Record<string, string | number>,
  ) {
    // `message` itself stays readable English (logs, MCP tool results).
    super(translate("en", message, vars));
    this.text = message;
  }
}
