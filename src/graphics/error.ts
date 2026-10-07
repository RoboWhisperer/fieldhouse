/** A plain-language error with an HTTP status; graphics-routes.ts turns it into an API error. */
export class GfxError extends Error { constructor(public status: number, msg: string) { super(msg); } }
