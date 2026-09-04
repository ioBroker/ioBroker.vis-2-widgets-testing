# ioBroker.vis-2-widgets-testing

With this library, you can test your own widgets for `ioBroker.vis` 2.0.

## How to use

The package is written in TypeScript and ships its own type declarations, so the helpers are typed in
JavaScript tests too.

Create the file `test/widgets.test.ts` with the following content:

```ts
import type { Browser, Page } from 'puppeteer';
import * as helper from '@iobroker/vis-2-widgets-testing';
import { name } from '../package.json';

// get the name of the widget set from package.json, e.g. `vis-2-widgets-material`
const adapterName = name.split('.').pop() as string;

let page: Page;
let browser: Browser;

describe(adapterName, () => {
    before(async function () {
        this.timeout(180_000); // because the installation could last some time

        // install js-controller, web and vis-2
        await helper.startIoBroker({ widgetsSetName: adapterName });

        // start the browser
        const result = await helper.startBrowser(true); // true = headless
        browser = result.browser;
        page = result.page;

        // create the default vis-2 project
        await helper.createProject(page);

        // open the palette of the own widget set
        await helper.palette.openWidgetSet(page, adapterName);
        await helper.screenshot(page, '02_widgets_opened');
    });

    it('Check all widgets', async function () {
        this.timeout(60_000);

        for (const widgetName of await helper.palette.getListOfWidgets(page, adapterName)) {
            const wid = await helper.palette.addWidget(page, widgetName);
            await helper.screenshot(page, `10_${widgetName}`);
            await helper.view.deleteWidget(page, wid);
        }
    });

    after(async function () {
        this.timeout(10_000);
        await helper.stopBrowser(browser);
        await helper.stopIoBroker();
    });
});
```

A test in JavaScript works just the same, the module is published as CommonJS:

```js
const helper = require('@iobroker/vis-2-widgets-testing');
```

Create the task in package.json:

```json
  "scripts": {
    ...
    "test": "mocha ./test/*.test.ts"
  },
```

Add `mocha` to devDependencies:

```json
  "devDependencies": {
    ...
    "mocha": "^12.0.0"
  },
```

### Options of `startIoBroker`

| Option                 | Default                | Description                                                           |
| ---------------------- | ---------------------- | --------------------------------------------------------------------- |
| `rootDir`              | the project under test | Directory that holds `tmp/` and the `package.json` of the widget set. |
| `widgetsSetName`       | from `package.json`    | Name of the widget set, e.g. `vis-2-widgets-material`.                |
| `additionalAdapters`   | `['web', 'vis-2']`     | Adapters that are installed next to the js-controller.                |
| `startOwnAdapter`      | `false`                | Start the adapter of the widget set itself too.                       |
| `mainGuiProject`       | from the adapters      | `vis` or `vis-2`.                                                     |
| `visUploadedTimeoutMs` | `120000`               | How long to wait until the GUI adapter has uploaded its files.        |

## Development

```bash
npm run build   # compile src/index.ts to build/
npm run check   # type check only
npm run lint    # eslint
```

## Changelog

### **WORK IN PROGRESS**

- (bluefox) Migrated the library to TypeScript. The package is compiled to `build/` and ships type
  declarations; the public API is unchanged.

### 1.0.6 (2025-05-19)

- (bluefox) Packages updated

### 1.0.5 (2024-12-02)

- (bluefox) Packages updated
- (bluefox) Added timeout parameter to `deleteWidget`

### 1.0.4 (2024-06-30)

- (bluefox) Packages updated

### 1.0.3 (2024-04-14)

- (bluefox) added support for the once mode

### 1.0.2 (2024-04-10)

- (bluefox) adjusted vis-2 testing

### 1.0.1 (2024-04-08)

- (foxriver76) pass options down to set up

### 1.0.0 (2023-12-15)

- (bluefox) added vis-1 testing

### 0.3.0 (2023-07-28)

- (bluefox) vis-2-beta is replaced with vis-2

### 0.2.7 (2023-05-09)

- (bluefox) initial commit

## License

The MIT License (MIT)

Copyright (c) 2023-2026 bluefox <dogafox@gmail.com>

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
