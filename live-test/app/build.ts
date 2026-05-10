import { copyFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const appDir = dirname(fileURLToPath(import.meta.url));

mkdirSync(join(appDir, "dist"), { recursive: true });
copyFileSync(join(appDir, "src", "index.html"), join(appDir, "dist", "index.html"));
