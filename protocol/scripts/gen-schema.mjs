// npm -w protocol run schema  ->  protocol/schema/{methods,events}.json
// methods.json: definitions.Methods.properties["<m>"].properties.{p,r}
// events.json : definitions.Events.properties["<ev>"]
import { createGenerator } from "ts-json-schema-generator";
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "schema");
mkdirSync(out, { recursive: true });

function gen(type, file) {
  const schema = createGenerator({
    path: join(root, "src", file),
    tsconfig: join(root, "tsconfig.json"),
    type,
    expose: "all",
    topRef: true,
    additionalProperties: true, // clients/servers ignore unknown fields (api.md 1.4)
    skipTypeCheck: false,
  }).createSchema(type);
  return schema;
}

const methods = gen("Methods", "methods.ts");
const events = gen("Events", "events.ts");
writeFileSync(join(out, "methods.json"), JSON.stringify(methods, null, 2) + "\n");
writeFileSync(join(out, "events.json"), JSON.stringify(events, null, 2) + "\n");
const mNames = Object.keys(methods.definitions.Methods.properties);
const eNames = Object.keys(events.definitions.Events.properties);
writeFileSync(join(out, "index.json"), JSON.stringify({ methods: mNames, events: eNames }, null, 2) + "\n");
console.log(`schema: ${mNames.length} methods, ${eNames.length} events -> ${out}`);
