# ioBroker.vis-2-widgets-testing
With this library, you can test your own widgets for ioBroker.vis 2.0.

## How to use
Create file `test/widgets.test.js` with following content:

```
const helper = require('@iobroker/vis-2-widgets-testing');
const adapterName = require('../package.json').name.split('.').pop(); // get widgets name from package.json
let page;
let browser;

let objects = null;
let states  = null;

describe('vis-2-widgets-material', () => {
    before(async function (){
        this.timeout(180000); // because installation could last some time
        
        // install js-controller, web and vis-2-beta
        let result = await helper.startIoBroker(adapterName);
        objects = result.objects;
        states  = result.states;

        // start browser
        result = await helper.startPuppeteer(true); // true = headless
        browser = result.browser;
        page = result.page;

        // Create default vis project
        await helper.createProject(page);

        // open widgets
        await page.waitForSelector(`#summary_${adapterName}`, { timeout: 5000 });
        await page.click(`#summary_${adapterName}`);
        await page.screenshot({path: 'tmp/screenshots/02_widgets_opened.png'});
    });

    it('Check all widgets', async function (){
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
```
  "scripts": {
    ...
    "test": "mocha ./test/*.test.js"
  },
```

Add `mocha` to devDependencies:
```
  "devDependencies": {
    ...
    "mocha": "^6.2.0"
  },
```  