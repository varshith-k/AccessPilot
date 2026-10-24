import { createServer } from "node:http";

const layout = (body: string) => `<!doctype html><html lang="en"><head>
  <meta charset="utf-8"><title>AccessPilot scholarship demo</title>
  <style>body{font:18px system-ui;max-width:700px;margin:32px auto;padding:0 20px}
  label{display:block;margin:16px 0}input,textarea,select,button{font:inherit;padding:8px}
  input:not([type=checkbox]),textarea{display:block;width:90%}button,a{margin:8px 0}
  :focus-visible{outline:3px solid #245ac4}#below{margin-top:1000px}</style>
  </head><body><p>AccessPilot — local test environment. Use fictional data only.</p>${body}</body></html>`;

/** Controlled loopback demo, shared by the CLI and real-browser tests. */
export async function startDemoSite(port = 0) {
  let submissions = 0;
  let mutationRequests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    if (request.url === "/slow") return; // Deliberately unfinished navigation for stop tests.
    if (request.method === "POST") mutationRequests++;
    if (request.url === "/submit" && request.method === "POST") {
      let length = 0;
      let body = "";
      request.on("data", (chunk: Buffer) => {
        length += chunk.length;
        if (length > 16_384) request.destroy();
        else body += chunk.toString("utf8");
      });
      request.on("end", () => {
        const fields = new URLSearchParams(body);
        if (!["name", "email", "program"].every((field) => fields.get(field)?.trim())) {
          response.statusCode = 422;
          response.end(layout("<h1>Missing application details</h1>"));
          return;
        }
        submissions++;
        response.end(
          layout(
            '<h1 id="confirmation">Application received</h1><p>Demo confirmation: AP-1001</p>',
          ),
        );
      });
      return;
    }
    if (request.url === "/scholarship") {
      response.end(
        layout(`<h1>Scholarship application</h1>
        <form action="/submit" method="post">
          <label>Full name<input id="name" name="name" autocomplete="name" required></label>
          <label>Email<input id="email" type="email" name="email" required></label>
          <label>Program<input id="program" name="program" required></label>
          <input type="hidden" name="demoToken" value="demo-only">
          <button id="submit">Submit application</button>
        </form>`),
      );
    } else if (request.url === "/controls") {
      response.end(
        layout(`<h1>Automation test controls</h1>
        <label>Notes<input id="notes"></label>
        <label>Private password<input id="password" type="password"></label>
        <label>Card number<input id="card" autocomplete="cc-number"></label>
        <label>Attachment<input id="file" type="file"></label>
        <button id="double" type="button" ondblclick="this.textContent='Double clicked'">Double click</button>
        <button id="disabled" disabled>Disabled</button>
        <button id="fetch" type="button" onclick="fetch('/mutation',{method:'POST'}).catch(()=>{})">Background request</button>
        <form id="hidden-form" action="/submit" method="post">
          <button id="script-submit" type="button" onclick="this.form.requestSubmit()">Continue</button>
          <button id="native-submit" type="button" onclick="this.form.submit()">Continue directly</button>
          <input id="implicit" name="answer">
          <button id="implicit-submit">Finish</button>
        </form>
        <button id="redirect" type="button" onclick="location.href='/redirect'">Open next page</button>
        <a href="/scholarship">Application</a>
        <div id="below">Below the fold</div>`),
      );
    } else if (request.url === "/redirect") {
      response.writeHead(302, { Location: "/scholarship" });
      response.end();
    } else if (request.url === "/mutation") {
      response.end(layout("<p>Mutation reached server</p>"));
    } else {
      response.end(
        layout('<h1>Demo scholarships</h1><a id="apply" href="/scholarship">Open application</a>'),
      );
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Demo server has no port.");
  return {
    origin: `http://127.0.0.1:${address.port}`,
    get submissions() {
      return submissions;
    },
    get mutationRequests() {
      return mutationRequests;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
        server.closeAllConnections();
      }),
  };
}
