const puppeteer = require('puppeteer');
const fs = require('fs');
const setup = require('@iobroker/legacy-testing');
const axios = require('axios');
const { blue, cyan, green, magenta, red, yellow } = require('colorette');

let rootDir = `${__dirname}/../../../`;
let objects = null;
let states  = null;
let onStateChanged = null;
let gBrowser;
let gPage;
let gOptions;

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

async function startBrowser(headless) {
    const browser = await puppeteer.launch({
        headless: headless === undefined ? false : headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
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

    // LOGGING
    gPage
        .on('console', message => {
            const type = message.type().substr(0, 3).toUpperCase();
            const colors = {
                LOG: text => text,
                ERR: red,
                WAR: yellow,
                INF: cyan,
            };

            const color = colors[type] || blue;
            console.log(color(`[BROWSER] ${type} ${message.text()}`));
        })
        .on('pageerror', ({ message }) => console.log(red(`[BROWSER] ${message}`)));
        /*.on('response', response =>
            console.log(green(`${response.status()} ${response.url()}`)))
        .on('requestfailed', request =>
            console.log(magenta(`${request.failure().errorText} ${request.url()}`)));*/

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

    gOptions = options;

    if (!gOptions.additionalAdapters) {
        gOptions.additionalAdapters = ['web', 'vis-2'];
    }

    if (gOptions.additionalAdapters.includes('vis-2')) {
        gOptions.visUploadedId = 'vis-2.0.info.uploaded';
        gOptions.mainGuiProject = gOptions.mainGuiProject || 'vis-2';
    } else
    if (gOptions.additionalAdapters.includes('vis')) {
        gOptions.visUploadedId = 'vis.0.info.uploaded';
        gOptions.mainGuiProject = gOptions.mainGuiProject || 'vis';
    }

    return new Promise(async resolve => {
        // delete the old project
        deleteFoldersRecursive(`${rootDir}tmp/iobroker-data/files/${gOptions.mainGuiProject}.0`);
        deleteFoldersRecursive(`${rootDir}tmp/screenshots`);
        try {
            fs.existsSync(`${rootDir}tmp/iobroker-data/files/${gOptions.mainGuiProject}.0`) && fs.unlinkSync(`${rootDir}tmp/iobroker-data/files/${gOptions.mainGuiProject}.0`);
        } catch (e) {
            console.error(`Cannot delete folder: ${e}`);
        }
        if (fs.existsSync(`${rootDir}tmp/iobroker-data/files/${gOptions.mainGuiProject}.0/_data.json`)) {
            try {
                fs.writeFileSync(`${rootDir}tmp/iobroker-data/files/${gOptions.mainGuiProject}.0/_data.json`, '{}');
            } catch (e) {
                console.error(`Cannot write file: ${e}`);
            }
        }

        for (let a = 0; a < gOptions.additionalAdapters.length; a++) {
            if (!gOptions.additionalAdapters[a].startsWith('iobroker.')) {
                gOptions.additionalAdapters[a] = `iobroker.${gOptions.additionalAdapters[a]}`;
            }
            if (!gOptions.additionalAdapters[a].includes('@')) {
                const version = await latestVersion(gOptions.additionalAdapters[a])
                gOptions.additionalAdapters[a] += `@${version}`;
                console.log(`Using version: ${gOptions.additionalAdapters[a]}`);
            }
        }

        setup.setupController(gOptions.additionalAdapters, async () => {
            if (gOptions.visUploadedId) {
                await setup.setOfflineState(gOptions.visUploadedId, { val: 0 });
            }

            // lets the web adapter start on port 18082
            let config = await setup.getAdapterConfig(0, 'web');
            if (config && config.common) {
                config.native.port = 18082;
                config.common.enabled = true;
                await setup.setAdapterConfig(config.common, config.native, 0, 'web');
            }

            config = await setup.getAdapterConfig(0, gOptions.mainGuiProject);
            if (config && config.common && !config.common.enabled) {
                config.common.enabled = true;
                await setup.setAdapterConfig(config.common, config.native, 0, gOptions.mainGuiProject);
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
                    for (let a = 0; a < options.additionalAdapters.length; a++) {
                        setup.startCustomAdapter(options.additionalAdapters[a].split('@')[0].replace('iobroker.', ''), 0);
                    }
                    if (options.startOwnAdapter) {
                        setup.startCustomAdapter(options.widgetsSetName, 0);
                    }
                    if (gOptions.visUploadedId) {
                        await checkIsVisUploadedAsync(states);
                    }
                    resolve({ objects, states });
                });
        });
    });
}

async function stopIoBroker() {
    for (let a = 0; a < gOptions.additionalAdapters.length; a++) {
        await setup.stopCustomAdapter(gOptions.additionalAdapters[a].split('@')[0].replace('iobroker.', ''), 0);
    }

    if (gOptions.startOwnAdapter) {
        await setup.stopCustomAdapter(gOptions.widgetsSetName, 0);
    }

    // wait till adapters are stopped
    await new Promise(resolve => setTimeout(resolve, 1000));

    await new Promise(resolve =>
        setup.stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            resolve();
        }));
}

async function createProject(page) {
    page = page || gPage;
    if (gOptions.mainGuiProject) {
        await page.goto(`http://127.0.0.1:18082/${gOptions.mainGuiProject}/edit.html`, { waitUntil: 'domcontentloaded' });
        if (gOptions.mainGuiProject.startsWith('vis')) {
            await page.waitForSelector('#create_new_project', {timeout: 10000});
            await page.click('#create_new_project');
        }
    }

    // Create directory
    !fs.existsSync(`${rootDir}tmp/screenshots`) && fs.mkdirSync(`${rootDir}tmp/screenshots`);
    await page.screenshot({path: `${rootDir}tmp/screenshots/00_create-project.png`});

    // create the default project
    if (gOptions.mainGuiProject.startsWith('vis')) {
        await page.waitForSelector('#create_new_project_ok_buton');
        await page.click('#create_new_project_ok_buton');
        await page.waitForSelector('#summary_tabs', {timeout: 60000}); // tabs are always visible
        await page.screenshot({path: `${rootDir}tmp/screenshots/01_loaded.png`});
    }
}

async function stopBrowser(browser) {
    browser = browser || gBrowser;
    await browser.close();
}

function checkIsVisUploaded(states, cb, counter) {
    counter = counter === undefined ? 20 : counter;
    if (counter === 0) {
        return cb && cb(`Cannot check value Of State ${gOptions.visUploadedId}`);
    }

    states.getState(gOptions.visUploadedId, (err, state) => {
        console.log(`[${counter}]Check if vis is uploaded ${gOptions.visUploadedId} = ${JSON.stringify(state)}`);
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

async function addWidget(page, widgetName) {
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

    await page.waitForSelector(`#${wid}`, { timeout: 2000 });
    return wid;
}

async function deleteWidget(page, wid){
    page = page || gPage;
    // select widget
    await page.click(`#${wid}`);
    await page.keyboard.press('Delete');
    await page.waitForSelector(`#ar_dialog_confirm_ok_deleteDialog`, { timeout: 2000 });
    await page.click('#ar_dialog_confirm_ok_deleteDialog');
}

async function openWidgetSet(page, widgetSetName) {
    page = page || gPage;
    await page.waitForSelector(`#summary_${widgetSetName}`, { timeout: 2000 });

    const el = await page.$(`#summary_${widgetSetName}`);
    const className = await (await el.getProperty('className')).jsonValue();
    if (!className.includes('vis-palette-summary-expanded')) {
        await page.click(`#summary_${widgetSetName}`);
    }
}

async function closeWidgetSet(page, widgetSetName) {
    page = page || gPage;
    try {
        await page.waitForSelector(`#summary_${widgetSetName}`, { timeout: 1000 });
        const el = await page.$(`#summary_${widgetSetName}`);
        const className = await (await el.getProperty('className')).jsonValue();
        if (className.includes('vis-palette-summary-expanded')) {
            await page.click(`#summary_${widgetSetName}`);
        }
    } catch (e) {
        // ignore error
        console.log('Cannot close widget set: ' + e);
    }
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
        result.push(wid.substring('widget_'.length));
    }
    return result;
}

async function getListOfWidgetSets(page)   {
    page = page || gPage;
    const widgets = await page.$$(`.vis-palette-widget-set`);
    const result = [];
    for (let w = 0; w < widgets.length; w++) {
        const wid = await (await widgets[w].getProperty('id')).jsonValue();
        result.push(wid.substring('summary_'.length));
    }
    return result;
}

module.exports = {
    startIoBroker,
    stopIoBroker,
    startBrowser,
    stopBrowser,
    createProject,
    setOnStateChanged: cb => onStateChanged = cb,
    checkIsVisUploaded,
    checkIsVisUploadedAsync,
    palette: {
        addWidget,
        openWidgetSet,
        getListOfWidgets,
        closeWidgetSet,
        getListOfWidgetSets,
    },
    view: {
        deleteWidget,
    },
    screenshot,
}