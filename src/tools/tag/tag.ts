import { NoteTag } from "@miden-sdk/miden-sdk";
import { parseAccountId, release } from "notecheck";

/** Bits of the target's ID prefix that `NoteTag.withAccountTarget` keeps by default. */
export const DEFAULT_TAG_LENGTH = 14;
export const MAX_TAG_LENGTH = 32;

export type TagInfo = {
  length: number;
  value: number;
  hex: string;
  /** 32-char binary string; the first `length` bits come from the account ID prefix. */
  bits: string;
  /** Rough share of all accounts that collide on this tag: 2^-length. */
  anonymitySet: string;
};

export function accountTag(rawId: string, length = DEFAULT_TAG_LENGTH): TagInfo {
  if (!Number.isInteger(length) || length < 0 || length > MAX_TAG_LENGTH) {
    throw new Error(`Tag length must be 0–${MAX_TAG_LENGTH}.`);
  }
  const { id } = parseAccountId(rawId);
  try {
    const tag = length === DEFAULT_TAG_LENGTH
      ? NoteTag.withAccountTarget(id)
      : NoteTag.withCustomAccountTarget(id, length);
    const value = tag.asU32() >>> 0;
    release(tag);
    return {
      length,
      value,
      hex: "0x" + value.toString(16).padStart(8, "0"),
      bits: value.toString(2).padStart(32, "0"),
      anonymitySet: length === 0 ? "every account" : `1 in ${(2 ** length).toLocaleString("en-US")}`,
    };
  } finally { release(id); }
}
