import { createHash } from "crypto";

/**
 * Compute a PayFast MD5 signature over an ORDERED list of form fields.
 *
 * PayFast signs the parameter string in the exact order the fields are
 * submitted: `key=urlencoded(value)` joined by `&`, with the passphrase appended
 * last. Values are URL-encoded with spaces as `+` and uppercase hex (PHP
 * urlencode style). Empty values are omitted. The same ordered list must be used
 * to build the form so the signature matches.
 */
export function payfastSignature(
  orderedFields: [string, string][],
  passphrase: string
): string {
  const encode = (v: string) =>
    encodeURIComponent(v.trim())
      .replace(/%20/g, "+")
      // PayFast (PHP urlencode) uses uppercase hex and encodes these too.
      .replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());

  const parts = orderedFields
    .filter(([, value]) => value !== "" && value != null)
    .map(([key, value]) => `${key}=${encode(value)}`);

  let str = parts.join("&");
  if (passphrase) str += `&passphrase=${encode(passphrase)}`;

  return createHash("md5").update(str).digest("hex");
}
