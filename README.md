# ioBroker.vis-2-widgets-testing

With this library, you can test your own widgets for `ioBroker.vis` 2.0.

## How to use

Create file `test/widgets.test.js` with the following content:

```js
const helper = require('@iobroker/vis-2-widgets-testing');
const adapterName = require('../package.json').name.split('.').pop(); // get widgets name from package.json
let page;
let browser;

let objects = null;
let states = null;

describe('vis-2-widgets-material', () => {
    before(async function () {
        this.timeout(180000); // because installation could last some time

        // install js-controller, web and vis-2
        let result = await helper.startIoBroker(adapterName);
        objects = result.objects;
        states = result.states;

        // start browser
        result = await helper.startPuppeteer(true); // true = headless
        browser = result.browser;
        page = result.page;

        // Create default vis project
        await helper.createProject(page);

        // open widgets
        await page.waitForSelector(`#summary_${adapterName}`, { timeout: 5000 });
        await page.click(`#summary_${adapterName}`);
        await page.screenshot({ path: 'tmp/screenshots/02_widgets_opened.png' });
    });

    it('Check all widgets', async function () {
        this.timeout(60000);
        const widgets = await page.$$(`.widget-${adapterName}`);
        for (let w = 0; w < widgets.length; w++) {
            const wid = await (await widgets[w].getProperty('id')).jsonValue();
            await helper.placeWidgetOnView(page, wid.substring('widget_'.length), true);
        }
    });

    after(async function () {
        this.timeout(5000);
        await helper.stopPuppeteer(browser);
        return helper.stopIoBroker();
    });
});
```

Create the task in package.json:

```json
  "scripts": {
    ...
    "test": "mocha ./test/*.test.js"
  },
```

Add `mocha` to devDependencies:

```json
  "devDependencies": {
    ...
    "mocha": "^6.2.0"
  },
```

## Changelog

<!-- ### **WORK IN PROGRESS** -->
### **WORK IN PROGRESS**

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

- (foxriver76) pass options down to setup

### 1.0.0 (2023-12-15)

- (bluefox) added vis-1 testing

### 0.3.0 (2023-07-28)

- (bluefox) vis-2-beta is replaced with vis-2

### 0.2.7 (2023-05-09)

- (bluefox) initial commit

## License

The MIT License (MIT)

Copyright (c) 2023-2025 bluefox <dogafox@gmail.com>

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
