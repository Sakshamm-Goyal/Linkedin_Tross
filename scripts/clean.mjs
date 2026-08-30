import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const buildDirectory = resolve(process.cwd(), "dist");
await rm(buildDirectory, { recursive: true, force: true });
