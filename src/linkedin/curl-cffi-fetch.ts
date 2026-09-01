import { spawn } from "node:child_process";
import { join } from "node:path";

interface CurlCffiOptions {
  pythonBin: string;
  proxyUrl?: string | undefined;
  impersonate: string;
}

interface BridgeResponse {
  status: number;
  headers: Array<[string, string]>;
  bodyBase64: string;
}

export async function curlCffiFetch(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  options: CurlCffiOptions,
): Promise<Response> {
  const headers: Array<[string, string]> = [];
  new Headers(init.headers).forEach((value, name) => headers.push([name, value]));
  const input = JSON.stringify({
    url,
    method: init.method ?? "GET",
    headers,
    bodyBase64: typeof init.body === "string" ? Buffer.from(init.body).toString("base64") : undefined,
    timeoutSeconds: timeoutMs / 1_000,
    impersonate: options.impersonate,
    proxy: options.proxyUrl,
  });
  const script = join(process.cwd(), "scripts", "curl_cffi_fetch.py");

  const output = await new Promise<string>((resolve, reject) => {
    const child = spawn(options.pythonBin, [script], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env, PYTHONUNBUFFERED: "1" },
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let stdoutBytes = 0;
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new DOMException("LinkedIn request timed out.", "TimeoutError"));
    }, timeoutMs + 2_000);

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBytes += chunk.length;
      if (stdoutBytes > 15 * 1024 * 1024) {
        child.kill("SIGKILL");
        reject(new Error("curl_cffi response exceeded the 15 MiB safety limit."));
        return;
      }
      stdout.push(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      if (stderr.reduce((total, value) => total + value.length, 0) < 64 * 1024) stderr.push(chunk);
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(Buffer.concat(stdout).toString("utf8"));
      else reject(new Error(`curl_cffi transport failed: ${Buffer.concat(stderr).toString("utf8").trim()}`));
    });
    child.stdin.end(input);
  });

  const result = JSON.parse(output) as BridgeResponse;
  if (!Number.isInteger(result.status) || !Array.isArray(result.headers) || typeof result.bodyBase64 !== "string") {
    throw new Error("curl_cffi returned an invalid response envelope.");
  }
  const responseHeaders = new Headers();
  for (const [name, value] of result.headers) responseHeaders.append(name, value);
  return new Response(Buffer.from(result.bodyBase64, "base64"), {
    status: result.status,
    headers: responseHeaders,
  });
}
