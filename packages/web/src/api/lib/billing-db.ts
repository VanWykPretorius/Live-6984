import type { db } from "../database";

/** Shared by normal queries and transactional invoice generation. */
export type BillingDb = Pick<typeof db, "select" | "insert" | "update" | "delete">;
