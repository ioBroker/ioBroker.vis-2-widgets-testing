const puppeteer = require('puppeteer');
const fs = require('fs');
const setup = require('@iobroker/legacy-testing');
const axios = require('axios');

let rootDir = `${__dirname}/../../../`;
let objects = null;
let states  = null;
let onStateChanged = null;
let gBrowser;
let gPage;

function deleteFoldersRecursive(path) {
    if (path.endsWith('/')) {
        path = path.substring(0, path.length - 1);
    }
    if (fs.existsSync(path)) {
        const files = fs.readdirSync(path);
        for (const file of files) {
            const curPath = `${path}/${file}`;
            const stat = fs.statSync(curPath);
            if (stat.isDirectory()) {
                deleteFoldersRecursive(curPath);
                fs.rmdirSync(curPath);
            } else {
                fs.unlinkSync(curPath);
            }
        }
    }
}

async function startPuppeteer(headless) {
    const browser = await puppeteer.launch({headless: !!headless});
    const pages = await browser.pages();
    const timeout = 5000;
    pages[0].setDefaultTimeout(timeout);

    await pages[0].setViewport( {
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
    });

    gBrowser = browser;
    gPage = pages[0];

    return { browser, page: pages[0] };
}

function latestVersion(packageName) {
    return axios
        .get(`https://registry.npmjs.org/${packageName}/latest`)
        .then(res => res.data.version);
}

function startIoBroker(options) {
    options = options || {};
    if (options.rootDir) {
        rootDir = options.rootDir;
    }
    if (!options.widgetsSetName) {
        const pack = require(`${rootDir}package.json`);
        options.widgetsSetName = pack.name.split('.').pop();
    }

    return new Promise(async resolve => {
        // delete the old project
        deleteFoldersRecursive(`${rootDir}tmp/iobroker-data/files/vis-2-beta.0`);
        deleteFoldersRecursive(`${rootDir}tmp/screenshots`);
        try {
            fs.existsSync(`${rootDir}tmp/iobroker-data/files/vis-2-beta.0`) && fs.unlinkSync(`${rootDir}tmp/iobroker-data/files/vis-2-beta.0`);
        } catch (e) {
            console.error(`Cannot delete folder: ${e}`);
        }
        if (fs.existsSync(`${rootDir}tmp/iobroker-data/files/vis-2-beta.0/_data.json`)) {
            try {
                fs.writeFileSync(`${rootDir}tmp/iobroker-data/files/vis-2-beta.0/_data.json`, '{}');
            } catch (e) {
                console.error(`Cannot write file: ${e}`);
            }
        }
        const webVersion = await latestVersion('iobroker.web');
        const visVersion = await latestVersion('iobroker.vis-2-beta');

        console.log(`Using web version: ${webVersion}, and vis-2-beta version: ${visVersion}`);

        // todo: detect latest versions of web and vis-2-beta
        setup.setupController([`iobroker.web@${webVersion}`, `iobroker.vis-2-beta@${visVersion}`], async () => {
            await setup.setOfflineState('vis-2-beta.0.info.uploaded', {val: 0});
            // lets the web adapter start on port 18082
            let config = await setup.getAdapterConfig(0, 'web');
            config.native.port = 18082;
            config.common.enabled = true;
            await setup.setAdapterConfig(config.common, config.native, 0, 'web');

            config = await setup.getAdapterConfig(0, 'vis-2-beta');
            if (!config.common.enabled) {
                config.common.enabled = true;
                await setup.setAdapterConfig(config.common, config.native, 0, 'vis-2-beta');
            }

            // enable widget set
            config = await setup.getAdapterConfig(0, options.widgetsSetName);
            if (config?.common && !config.common.enabled) {
                config.common.enabled = true;
                await setup.setAdapterConfig(config.common, config.native, 0, options.widgetsSetName);
            }

            setup.startController(
                false, // do not start widgets
                (id, obj) => {},
                (id, state) => onStateChanged && onStateChanged(id, state),
                async (_objects, _states) => {
                    objects = _objects;
                    states = _states;
                    setup.startCustomAdapter('web', 0);
                    setup.startCustomAdapter('vis-2-beta', 0);
                    await checkIsVisUploadedAsync(states);
                    resolve({ objects, states });
                });
        });
    });
}

async function stopIoBroker() {
    await setup.stopCustomAdapter('vis-2-beta', 0);
    await setup.stopCustomAdapter('web', 0);

    await new Promise(resolve =>
        setup.stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            resolve();
        }));
}

async function createProject(page) {
    page = page || gPage;
    await page.goto('http://127.0.0.1:18082/vis-2-beta/edit.html', { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('#create_new_project', { timeout: 10000 });
    await page.click('#create_new_project');

    // Create directory
    !fs.existsSync(`${rootDir}tmp/screenshots`) && fs.mkdirSync(`${rootDir}tmp/screenshots`);
    await page.screenshot({path: `${rootDir}tmp/screenshots/00_create-project.png`});

    // create the default project
    await page.waitForSelector('#create_new_project_ok_buton');
    await page.click('#create_new_project_ok_buton');
    await page.waitForSelector('#summary_tabs', { timeout: 60000 }); // tabs are always visible
    await page.screenshot({path: `${rootDir}tmp/screenshots/01_loaded.png`});
}

async function stopPuppeteer(browser) {
    browser = browser || gBrowser;
    await browser.close();
}

const VIS_UPLOADED_ID = 'vis-2-beta.0.info.uploaded';

function checkIsVisUploaded(states, cb, counter) {
    counter = counter === undefined ? 20 : counter;
    if (counter === 0) {
        return cb && cb(`Cannot check value Of State ${VIS_UPLOADED_ID}`);
    }

    states.getState(VIS_UPLOADED_ID, (err, state) => {
        console.log(`[${counter}]Check if vis is uploaded ${VIS_UPLOADED_ID} = ${JSON.stringify(state)}`);
        err && console.error(err);
        if (state && state.val) {
            cb && cb();
        } else {
            setTimeout(() =>
                checkIsVisUploaded(states, cb, counter - 1), 500);
        }
    });
}

function checkIsVisUploadedAsync(states, counter) {
    return new Promise(resolve => checkIsVisUploaded(states, resolve, counter));
}

async function placeWidgetOnView(page, widgetName, withDelete) {
    page = page || gPage;
    await page.waitForSelector(`#widget_${widgetName}`, { timeout: 5000 });

    /*
    // place this widget on the view
    const widget = await page.$(`#widget_${widgetName}`);
    const boundingBox = await widget.boundingBox();

    const view = await page.$(`#vis-react-container`);
    const boundingBoxView = await view.boundingBox();

    await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2);
    console.log('Mouse moved');
    await page.waitForTimeout(5000);
    await page.mouse.down();
    console.log('Mouse down');
    await page.waitForTimeout(5000);
    await page.screenshot({path: `tmp/screenshots/10_${widgetName}_00.png`});

    console.log('Mouse moved to view');
    await page.mouse.move(boundingBoxView.x + boundingBoxView.width / 2, boundingBoxView.y + boundingBoxView.height / 2);
    await page.waitForTimeout(5000);
    await page.screenshot({path: `tmp/screenshots/10_${widgetName}_01.png`});

    console.log('Mouse moved to view');
    await page.mouse.move(boundingBoxView.x + boundingBoxView.width / 2, boundingBoxView.y + boundingBoxView.height / 2);
    await page.waitForTimeout(5000);
    await page.screenshot({path: `tmp/screenshots/10_${widgetName}_02.png`});

    await page.mouse.up();
    console.log('Mouse up');
     */

    const wid = await page.evaluate(async (_widgetName) => {
        return await window.visAddWidget(_widgetName, 0, 0);
    }, widgetName);

    console.log(`Widget added: ${wid}`);
    await page.waitForSelector(`#${wid}`, { timeout: 2000 });
    await page.screenshot({path: `${rootDir}tmp/screenshots/10_${widgetName}.png`});
    if (withDelete) {
        // select widget
        await page.click(`#${wid}`);
        await page.keyboard.press('Delete');
        await page.waitForSelector(`#ar_dialog_confirm_ok_deleteDialog`, { timeout: 2000 });
        await page.click('#ar_dialog_confirm_ok_deleteDialog');
    }
}

async function openWidgetSet(page, widgetSetName) {
    page = page || gPage;
    await page.waitForSelector(`#summary_${widgetSetName}`, { timeout: 2000 });
    await page.click(`#summary_${widgetSetName}`);
}

async function screenshot(page, fileName) {
    page = page || gPage;
    await page.screenshot({path: `${rootDir}tmp/screenshots/${fileName}.png`});
}

async function getListOfWidgets(page, widgetSetName)   {
    page = page || gPage;
    const widgets = await page.$$(`.widget-${widgetSetName}`);
    const result = [];
    for (let w = 0; w < widgets.length; w++) {
        const wid = await (await widgets[w].getProperty('id')).jsonValue();
        result.push(wid);
    }
    return result;
}

module.exports = {
    startIoBroker,
    stopIoBroker,
    startPuppeteer,
    stopPuppeteer,
    createProject,
    setOnStateChanged: cb => onStateChanged = cb,
    checkIsVisUploaded,
    checkIsVisUploadedAsync,
    placeWidgetOnView,
    openWidgetSet,
    screenshot,
    getListOfWidgets,
}