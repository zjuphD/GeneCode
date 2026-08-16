type UserAgentInput =
  | string
  | { headers?: Record<string, string | undefined> }
  | undefined;

export interface IsMobileOptions {
  ua?: UserAgentInput;
  tablet?: boolean;
  featureDetect?: boolean;
}

const MOBILE_RE = /(android|bb\d+|meego).+mobile|armv7l|avantgo|bada\/|blackberry|blazer|compal|elaine|fennec|hiptop|iemobile|ip(hone|od)|iris|kindle|lge |maemo|midp|mmp|mobile.+firefox|netfront|opera m(ob|in)i|palm( os)?|phone|p(ixi|re)\/|plucker|pocket|psp|series[46]0|samsungbrowser|symbian|treo|up\.(browser|link)|vodafone|wap|windows (ce|phone)|xda|xiino/i;
const NOT_MOBILE_RE = /CrOS/;
const TABLET_RE = /android|ipad|playbook|silk/i;

function readUserAgent(input: UserAgentInput): string {
  if (typeof input === "string") return input;
  if (input?.headers?.["user-agent"]) return input.headers["user-agent"];
  return typeof navigator === "undefined" ? "" : navigator.userAgent;
}

/**
 * OVE uses `is-mobile` to collapse split panes. macOS WKWebView can include a
 * Mobile token, so treat Tauri as desktop while preserving browser detection.
 */
export default function isMobile(options: IsMobileOptions = {}): boolean {
  if (
    typeof window !== "undefined" &&
    "__TAURI_INTERNALS__" in window
  ) {
    return false;
  }

  const ua = readUserAgent(options.ua);
  if (!ua) return false;
  const mobile = MOBILE_RE.test(ua) && !NOT_MOBILE_RE.test(ua);
  if (mobile || (options.tablet && TABLET_RE.test(ua))) return true;

  return Boolean(
    options.tablet &&
      options.featureDetect &&
      typeof navigator !== "undefined" &&
      navigator.maxTouchPoints > 1 &&
      ua.includes("Macintosh") &&
      ua.includes("Safari"),
  );
}
