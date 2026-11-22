// ajv validators over protocol/schema/{methods,events}.json
import Ajv from "ajv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const schemaDir = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "protocol", "schema");
const read = (f) => JSON.parse(readFileSync(join(schemaDir, f), "utf8"));

export const methodsSchema = read("methods.json");
export const eventsSchema = read("events.json");
export const index = read("index.json");

const ajv = new Ajv({ strict: false, allErrors: true });
ajv.addSchema(methodsSchema, "methods");
ajv.addSchema(eventsSchema, "events");
const cache = new Map();

function compile(ref) {
  let v = cache.get(ref);
  if (!v) { v = ajv.compile({ $ref: ref }); cache.set(ref, v); }
  return v;
}
const fmt = (errs) => (errs ?? []).slice(0, 6).map((e) => `${e.instancePath || "/"} ${e.message}`).join("; ");

/** which: "p" | "r". Returns null when valid, else an error string. */
export function checkMethod(m, which, value) {
  if (!index.methods.includes(m)) return `method ${m} is not in the schema`;
  const v = compile(`methods#/definitions/Methods/properties/${m}/properties/${which}`);
  return v(value) ? null : fmt(v.errors);
}
export function checkEvent(ev, value) {
  if (!index.events.includes(ev)) return `event ${ev} is not in the schema`;
  const v = compile(`events#/definitions/Events/properties/${ev}`);
  return v(value) ? null : fmt(v.errors);
}
