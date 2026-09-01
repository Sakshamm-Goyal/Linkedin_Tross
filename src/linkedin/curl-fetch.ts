import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function curlFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  proxyUrl?: string,
): Promise<Response> {
  const directory = await mkdtemp(join(tmpdir(), "linkedin-http-"));
  const headerFile = join(directory, "headers");
  await writeFile(headerFile, "", { mode: 0o600 });

  try {
    const headers = new Headers(init.headers);
    const args = [
      "--silent",
      "--show-error",
      "--max-time",
      String(Math.ceil(timeoutMs / 1_000)),
      "--request",
      init.method ?? "GET",
      "--dump-header",
      headerFile,
      "--url",
      url,
    ];
    if (proxyUrl) args.push("--proxy", proxyUrl);
    headers.forEach((value, name) => args.push("--header", `${name}: ${value}`));
    if (typeof init.body === "string") args.push("--data-raw", init.body);

    const { stdout } = await execFileAsync("curl", args, {
      encoding: "buffer",
      maxBuffer: 10 * 1024 * 1024,
    });
    const rawHeaders = await readFile(headerFile, "utf8");
    const blocks = rawHeaders.trim().split(/\r?\n\r?\n/).filter((block) => block.startsWith("HTTP/"));
    const finalBlock = blocks.at(-1);
    const status = Number(/^HTTP\/\S+\s+(\d+)/.exec(finalBlock ?? "")?.[1]);
    if (!Number.isInteger(status)) throw new Error("curl returned no parseable HTTP status.");

    const responseHeaders = new Headers();
    for (const line of finalBlock?.split(/\r?\n/).slice(1) ?? []) {
      const separator = line.indexOf(":");
      if (separator <= 0) continue;
      responseHeaders.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
    }
    return new Response(stdout, { status, headers: responseHeaders });
  } catch (error) {
    if ((error as { code?: number }).code === 28) {
      throw new DOMException("LinkedIn request timed out.", "TimeoutError");
    }
    throw error;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
