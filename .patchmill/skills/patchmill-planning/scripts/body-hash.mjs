#!/usr/bin/env node
// Prints the SHA-256 of a planning document's body: the text before its
// `## Planning review` record. Headings inside fenced code blocks are ignored.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const RECORD = /^## Planning review[ \t]*$/;
const SECTION = /^ {0,3}#{1,2}(?:[ \t]|$)/;
const FENCE = /^ {0,3}(`{3,}|~{3,})(.*)$/;

/**
 * Return the text before the Planning review record, or the whole text when
 * the document has no record.
 * @param {string} text
 * @returns {string}
 */
export function planningBody(text) {
  const lines = text.split("\n");
  /** @type {{ char: string; length: number } | undefined} */
  let fence;
  /** @type {number | undefined} */
  let record;
  for (let index = 0; index < lines.length; index++) {
    // Match without a CRLF terminator. The returned body keeps the raw bytes.
    const line = (lines[index] ?? "").replace(/\r$/, "");
    const match = FENCE.exec(line);
    if (fence) {
      const marker = match?.[1];
      if (
        marker &&
        marker[0] === fence.char &&
        marker.length >= fence.length &&
        (match?.[2] ?? "").trim() === ""
      )
        fence = undefined;
      continue;
    }
    if (match?.[1]) {
      const marker = match[1];
      if (!(marker[0] === "`" && (match[2] ?? "").includes("`"))) {
        fence = { char: marker[0] ?? "", length: marker.length };
        continue;
      }
    }
    if (RECORD.test(line)) {
      if (record !== undefined)
        throw new Error(
          "The document has more than one Planning review section.",
        );
      record = index;
    } else if (record !== undefined && SECTION.test(line)) {
      throw new Error(
        `Planning review must be the last section (line ${index + 1}).`,
      );
    }
  }
  if (record === undefined) return text;
  return lines
    .slice(0, record)
    .map((line) => `${line}\n`)
    .join("");
}

/**
 * Return the lowercase hex SHA-256 of the document body as UTF-8.
 * @param {string} text
 * @returns {string}
 */
export function bodyHash(text) {
  return createHash("sha256").update(planningBody(text), "utf8").digest("hex");
}

const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  const file = process.argv[2];
  try {
    if (!file) throw new Error("Usage: body-hash.mjs <document>");
    process.stdout.write(`${bodyHash(readFileSync(file, "utf8"))}\n`);
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    );
    process.exitCode = 1;
  }
}
