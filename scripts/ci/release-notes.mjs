#!/usr/bin/env node
// Prints the GitHub release body for a version to stdout.  node scripts/ci/release-notes.mjs <version>
const v = process.argv[2];
if (!v) { console.error("usage: release-notes.mjs <version>"); process.exit(2); }
// User-facing notes for this version (Vietnamese + English) come first when docs/release/notes/<version>.md exists.
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
const notesFile = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "docs", "release", "notes", `${v}.md`);
if (existsSync(notesFile)) console.log(readFileSync(notesFile, "utf8").trim() + "\n\n---\n");
console.log(`MinMusic for Windows ${v} (64-bit, Windows 10/11).

- **Installer:** \`MinMusic-${v}-windows-x64-setup.exe\` installs for the current user (no admin). Installing a newer version upgrades in place and keeps your library and settings. It also removes a v1 install silently.
- **Portable:** \`MinMusic-${v}-portable-x64.zip\`; unzip anywhere and run \`MinMusic.exe\`. Portable copies are not auto-updated.
- The files are not code-signed (no Authenticode), so Windows SmartScreen may say "Unknown publisher": choose **More info** and then **Run anyway**. In-app updates are verified with a minisign signature.
- Check a download with \`certutil -hashfile <file> SHA256\` against the matching \`.sha256\` file.`);
