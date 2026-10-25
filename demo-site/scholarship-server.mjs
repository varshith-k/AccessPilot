import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const PAGE = join(dirname(fileURLToPath(import.meta.url)), "scholarship.html");
const MAX_BODY = 64 * 1024;
const CONFIRMATION_NUMBER = "4821";

const escapeHtml = (value) =>
  String(value).replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c],
  );

function confirmationPage(fields) {
  const rows = Object.entries(fields)
    .map(([label, value]) => `<dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd>`)
    .join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Application submitted</title>
<link href="https://fonts.googleapis.com/css2?family=Geist:wght@400;600;700&display=swap" rel="stylesheet">
<style>
:root{color-scheme:light dark;--bg:#fafafa;--card:#fff;--text:#171717;--muted:#6b6b6b;--border:#eaeaea;--ok:#166534;--ok-soft:#f0fdf4}
@media (prefers-color-scheme:dark){:root{--bg:#09090b;--card:#18181b;--text:#fafafa;--muted:#a1a1aa;--border:#27272a;--ok:#4ade80;--ok-soft:#0f2a1a}}
body{margin:0;background:var(--bg);color:var(--text);font-family:"Geist",system-ui,-apple-system,"Segoe UI",sans-serif;font-size:16px;line-height:1.55;-webkit-font-smoothing:antialiased}
main{max-width:40rem;margin:0 auto;padding:3rem 1rem}
h1{font-size:2rem;letter-spacing:-.02em;margin:0 0 .75rem}
.ok{display:inline-block;padding:.35rem .9rem;border-radius:999px;background:var(--ok-soft);color:var(--ok);font-weight:600;margin:0}
dl{margin:1.75rem 0 0;padding:1.5rem 1.75rem;background:var(--card);border:1px solid var(--border);border-radius:1rem}
dt{font-size:.875rem;font-weight:600;color:var(--muted);margin-top:1rem}dt:first-child{margin-top:0}dd{margin:.15rem 0 0}
</style></head>
<body><main><h1>Application submitted</h1><p class="ok" role="status">Confirmation number ${CONFIRMATION_NUMBER}.</p><dl>${rows}</dl></main></body></html>`;
}

function readForm(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("too large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () =>
      resolve(Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()))),
    );
    request.on("error", reject);
  });
}

/** A deliberately plain scholarship form for demos and tests. Nothing is stored. */
export function createDemoServer() {
  return createServer(async (request, response) => {
    const { pathname } = new URL(request.url ?? "/", "http://localhost");
    const headers = {
      "Content-Type": "text/html; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    };
    try {
      if (request.method === "GET" && (pathname === "/" || pathname === "/scholarship")) {
        response.writeHead(200, headers).end(await readFile(PAGE));
      } else if (request.method === "POST" && pathname === "/submit") {
        const form = await readForm(request);
        const required = ["name", "email", "program"];
        if (required.some((key) => !String(form[key] ?? "").trim())) {
          response
            .writeHead(400, headers)
            .end(
              '<!doctype html><title>Missing details</title><p role="alert">Please fill in your name, email and program.</p>',
            );
          return;
        }
        response.writeHead(200, headers).end(
          confirmationPage({
            Name: form.name ?? "",
            Email: form.email ?? "",
            Program: form.program ?? "",
            "Start date": form.start ?? "",
          }),
        );
      } else if (pathname === "/health") {
        response.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
      } else {
        response
          .writeHead(404, headers)
          .end("<!doctype html><title>Not found</title><p>Page not found.</p>");
      }
    } catch {
      response
        .writeHead(400, headers)
        .end("<!doctype html><title>Bad request</title><p>That request could not be read.</p>");
    }
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4000);
  // Local only: the form accepts anything and must never be exposed beyond this machine.
  createDemoServer().listen(port, "127.0.0.1", () => {
    process.stdout.write(`Demo scholarship site: http://localhost:${port}/scholarship\n`);
  });
}
