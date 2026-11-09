import { connect } from "@bunny.net/database-client";
import { env } from "./env";

// `connect()` finds credentials only through `process.env`, and Edge Scripting
// is Deno, so they are passed in. Queries are tagged templates: interpolated
// values are bound, never concatenated into the SQL.
export const db = connect({
  url: env("BUNNY_DATABASE_URL"),
  authToken: env("BUNNY_DATABASE_AUTH_TOKEN"),
});
