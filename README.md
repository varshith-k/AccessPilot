# AccessPilot

> Hackathon project — open source, MIT licensed.

<!-- TODO: one-sentence description of what AccessPilot does -->

## Why

<!-- TODO: the problem this solves and who it is for -->

## Features

- TODO

## Getting started

```bash
git clone https://github.com/varshith-k/AccessPilot.git
cd AccessPilot
# TODO: install and run instructions
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

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) and our [Code of Conduct](CODE_OF_CONDUCT.md).

## Team

<!-- TODO: team members -->

## License

[MIT](LICENSE)
