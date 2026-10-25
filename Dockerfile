# AccessPilot: UI + API + agent in one long-running service (tasks live in memory, so run one
# instance). Based on Playwright's image, which includes the matching Chromium. Google Chrome is
# not installed here, so the agent falls back to that bundled Chromium automatically.
FROM mcr.microsoft.com/playwright:v1.64.1-noble

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# Baked into the browser bundle at build time: the UI talks to this server's own /api routes.
ENV NEXT_PUBLIC_TASK_CLIENT=http
RUN npm run build

ENV NODE_ENV=production \
    ACCESSPILOT_AGENT=fake \
    ACCESSPILOT_PLANNER=gemma \
    ACCESSPILOT_BROWSER=real \
    ACCESSPILOT_ACTIONS=twinly \
    ACCESSPILOT_TWINLY_MAX_REQUESTS=20

EXPOSE 3000
# The demo scholarship site runs alongside on 127.0.0.1:4000 (reachable by the agent's browser
# as http://localhost:4000/scholarship). It reads PORT too, so pin it before Railway's PORT applies.
CMD ["sh", "-c", "PORT=4000 node demo-site/scholarship-server.mjs & exec npx next start -H 0.0.0.0 -p ${PORT:-3000}"]
