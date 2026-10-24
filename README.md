# AccessPilot

> Hackathon project (Gator Hack V, UF AI Days 2026). Open source, MIT licensed.

AccessPilot is a voice-first assistant that completes confusing website tasks for people who use
screen readers, while keeping them informed and in control.

## Why

Many websites are built for sighted mouse users. Unlabeled buttons, date pickers made of `div`s,
and errors shown only in red leave a screen reader announcing "button, button, image," and the
user gets stuck. AI agents can click through websites, but they don't keep a blind user informed,
in control, and asked before anything consequential happens. AccessPilot does.

## Features

- **Page map:** "This page has a login link, a 6-field form, and a Submit button."
- **Step-by-step narration** while a separate browser window does the work.
- **Approval before anything consequential:** it reads back every detail and asks "Should I
  submit?" Nothing happens without an explicit yes. Escape and unclear answers never approve.
- **Hand-offs:** for passwords, card numbers, and CAPTCHAs it hands control back and waits.
- **Stop from anywhere:** one keypress (Alt+Shift+S) or the word "stop".
- **Voice or keyboard:** push-to-talk in Chrome, and full keyboard operation in any modern
  browser.

## Getting started

Requires Node.js 20.9 or newer.

```bash
git clone https://github.com/varshith-k/AccessPilot.git
cd AccessPilot
npm install
npm run dev
```

## Browser automation module

Person 4's Playwright controller supports permitted navigation, screenshots, DOM
context, structured action execution, explicit approval, stop/cancellation, and
outcome verification. See [the integration contract](docs/BROWSER.md).

```sh
npm ci
npx playwright install chromium
npm run test:browser
npm run demo:browser
```

The demo uses a local scholarship site and mocked Twinly proposals. It requires
an explicit `yes` before submission. See [the demo guide](docs/BROWSER-DEMO.md).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and our
[Code of Conduct](CODE_OF_CONDUCT.md).

## Team

<!-- TODO: team members -->

## License

[MIT](LICENSE)
