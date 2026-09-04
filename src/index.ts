import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import axios from 'axios';
import { blue, cyan, /* green, magenta,*/ red, yellow } from 'colorette';
import * as setup from '@iobroker/legacy-testing';
// puppeteer is an ES module and this package is published as CommonJS, so it can only be loaded with a
// dynamic `import()`. `Browser` and `Page` are types, they are erased and cost nothing at runtime.
import type { Browser, Page } from 'puppeteer' with { 'resolution-mode': 'import' };
import type { LegacyTestingOptions, ObjectsClient, StatesClient } from '@iobroker/legacy-testing';

export type { ObjectsClient, StatesClient };

export interface TestingOptions extends LegacyTestingOptions {
    /**
     * Name of the widget set, e.g. `vis-2-widgets-material`. Read from the `package.json` of the project under
     * test when it is not given.
     */
    widgetsSetName?: string;
    /** Adapters that are installed next to the js-controller. Default: `['web', 'vis-2']`. */
    additionalAdapters?: string[];
    /** Start the adapter of the widget set itself too. */
    startOwnAdapter?: boolean;
    /** `vis` or `vis-2`; derived from `additionalAdapters` when it is not given. */
    mainGuiProject?: string;
    /** State that tells that the GUI adapter has uploaded its files. Derived from `additionalAdapters`. */
    visUploadedId?: string;
    /** How long to wait for the upload of the GUI adapter. Default: 120000 ms. */
    visUploadedTimeoutMs?: number;
}

/** Options after `startIoBroker` has filled in everything that can be derived */
interface ResolvedTestingOptions extends TestingOptions {
    widgetsSetName: string;
    additionalAdapters: string[];
}

export interface IoBrokerHandles {
    objects: ObjectsClient;
    states: StatesClient;
}

export interface BrowserHandles {
    browser: Browser;
    page: Page;
}

export type StateChangeHandler = (id: string, state: ioBroker.State | null | undefined) => void;

/**
 * Root of the project that is being tested.
 *
 * This file is published as `build/index.js`, so the default has to walk up one level more than the folder of
 * the package: `build` -> the package -> `@iobroker` -> `node_modules` -> the project under test.
 */
let rootDir = `${__dirname}/../../../../`;
let onStateChanged: StateChangeHandler | null = null;
let gBrowser: Browser | null = null;
let gPage: Page | null = null;
let gOptions: ResolvedTestingOptions | null = null;

/**
 * Get the options of the running instance.
 *
 * @returns the options `startIoBroker` was set up with
 */
function requireOptions(): ResolvedTestingOptions {
    if (!gOptions) {
        throw new Error('startIoBroker() must be called first');
    }
    return gOptions;
}

/**
 * Get the page to work on.
 *
 * @param page page given by the caller; the page of `startBrowser` is used when it is missing
 * @returns the page to work on
 */
function requirePage(page?: Page | null): Page {
    const result = page || gPage;
    if (!result) {
        throw new Error('startBrowser() must be called first');
    }
    return result;
}

/**
 * Remove a folder with everything in it.
 *
 * This used to walk the tree by hand and leave the folder itself behind, and the caller then tried to
 * `unlinkSync` it - which cannot remove a directory and threw `EPERM` on Windows every single run. The message
 * was only logged, so the old project survived and the test failed much later, waiting for a screen that only
 * appears when there is no project.
 *
 * @param path folder to remove; a path that is not there is not an error
 */
function deleteFoldersRecursive(path: string): void {
    rmSync(path.endsWith('/') ? path.substring(0, path.length - 1) : path, { recursive: true, force: true });
}

/**
 * Open a browser and take its first page.
 *
 * @param headless run without a window; default is `false`
 * @param timeout default timeout of the page in ms
 * @returns the browser and its first page
 */
export async function startBrowser(headless?: boolean, timeout?: number): Promise<BrowserHandles> {
    const { default: puppeteer } = await import('puppeteer');

    const browser = await puppeteer.launch({
        headless: headless === undefined ? false : headless,
        args: ['--no-sandbox', '--disable-setuid-sandbox'],
    });
    const pages = await browser.pages();
    const page = pages[0];
    page.setDefaultTimeout(timeout || 5000);

    await page.setViewport({
        width: 1920,
        height: 1080,
        deviceScaleFactor: 1,
    });

    gBrowser = browser;
    gPage = page;

    // LOGGING
    page.on('console', message => {
        const type = message.type().substring(0, 3).toUpperCase();
        const colors: Record<string, (text: string) => string> = {
            LOG: text => text,
            ERR: red,
            WAR: yellow,
            INF: cyan,
        };

        const color = colors[type] || blue;
        console.log(color(`[BROWSER] ${type} ${message.text()}`));
    });
    page.on('pageerror', error =>
        console.log(red(`[BROWSER] ${error instanceof Error ? error.message : String(error)}`)),
    );
    /*.on('response', response =>
            console.log(green(`${response.status()} ${response.url()}`)))
        .on('requestfailed', request =>
            console.log(magenta(`${request.failure().errorText} ${request.url()}`)));*/

    return { browser, page };
}

/**
 * Ask npm for the newest version of a package.
 *
 * @param packageName name of the package on npm
 * @returns the version, e.g. `1.2.3`
 */
async function latestVersion(packageName: string): Promise<string> {
    const response = await axios.get<{ version: string }>(`https://registry.npmjs.org/${packageName}/latest`);
    return response.data.version;
}

/**
 * Install and start the js-controller together with the adapters the widgets need.
 *
 * @param options what to install and where
 * @returns the objects and states clients of the running controller
 */
export async function startIoBroker(options: TestingOptions = {}): Promise<IoBrokerHandles> {
    if (Object.keys(options).length) {
        setup.setOptions(options);
        setup.initialize();
    }

    if (options.rootDir) {
        rootDir = options.rootDir;
    }

    let widgetsSetName = options.widgetsSetName;
    if (!widgetsSetName) {
        const pack = JSON.parse(readFileSync(`${rootDir}package.json`, 'utf8')) as { name: string };
        const parts = pack.name.split('.');
        widgetsSetName = parts[parts.length - 1];
    }

    const resolved: ResolvedTestingOptions = {
        ...options,
        widgetsSetName,
        additionalAdapters: options.additionalAdapters || ['web', 'vis-2'],
    };

    if (resolved.additionalAdapters.includes('vis-2')) {
        resolved.visUploadedId = 'vis-2.0.info.uploaded';
        resolved.mainGuiProject = resolved.mainGuiProject || 'vis-2';
    } else if (resolved.additionalAdapters.includes('vis')) {
        resolved.visUploadedId = 'vis.0.info.uploaded';
        resolved.mainGuiProject = resolved.mainGuiProject || 'vis';
    }

    gOptions = resolved;

    // delete the old project
    deleteFoldersRecursive(`${rootDir}tmp/iobroker-data/files/${resolved.mainGuiProject}.0`);
    deleteFoldersRecursive(`${rootDir}tmp/screenshots`);
    if (existsSync(`${rootDir}tmp/iobroker-data/files/${resolved.mainGuiProject}.0/_data.json`)) {
        try {
            writeFileSync(`${rootDir}tmp/iobroker-data/files/${resolved.mainGuiProject}.0/_data.json`, '{}');
        } catch (e) {
            console.error(`Cannot write file: ${e as Error}`);
        }
    }

    for (let a = 0; a < resolved.additionalAdapters.length; a++) {
        if (!resolved.additionalAdapters[a].startsWith('iobroker.')) {
            resolved.additionalAdapters[a] = `iobroker.${resolved.additionalAdapters[a]}`;
        }
        if (!resolved.additionalAdapters[a].includes('@')) {
            const version = await latestVersion(resolved.additionalAdapters[a]);
            resolved.additionalAdapters[a] += `@${version}`;
            console.log(`Using version: ${resolved.additionalAdapters[a]}`);
        }
    }

    return new Promise<IoBrokerHandles>((resolve, reject) => {
        setup.setupController(resolved.additionalAdapters, () => {
            void (async (): Promise<void> => {
                if (resolved.visUploadedId) {
                    await setup.setOfflineState(resolved.visUploadedId, { val: 0 });
                }

                // lets the web adapter start on port 18082
                let config = await setup.getAdapterConfig(0, 'web');
                if (config?.common) {
                    config.native.port = 18082;
                    config.common.enabled = true;
                    await setup.setAdapterConfig(config.common, config.native, 0, 'web');
                }

                config = await setup.getAdapterConfig(0, resolved.mainGuiProject);
                if (config?.common && !config.common.enabled) {
                    config.common.enabled = true;
                    await setup.setAdapterConfig(config.common, config.native, 0, resolved.mainGuiProject);
                }

                // enable widget set
                config = await setup.getAdapterConfig(0, resolved.widgetsSetName);
                if (config?.common && !config.common.enabled) {
                    config.common.enabled = true;
                    await setup.setAdapterConfig(config.common, config.native, 0, resolved.widgetsSetName);
                }

                setup.startController(
                    false, // do not start widgets
                    () => {},
                    (id, state) => onStateChanged?.(id, state),
                    (_objects, _states) => {
                        void (async (): Promise<void> => {
                            for (let a = 0; a < resolved.additionalAdapters.length; a++) {
                                setup.startCustomAdapter(
                                    resolved.additionalAdapters[a].split('@')[0].replace('iobroker.', ''),
                                    0,
                                );
                            }
                            if (resolved.startOwnAdapter) {
                                setup.startCustomAdapter(resolved.widgetsSetName, 0);
                            }
                            if (resolved.visUploadedId) {
                                // it resolves with a message instead of throwing, and that message used to be
                                // dropped - the run then carried on with an adapter that was not ready
                                const error = await checkIsVisUploadedAsync(_states);
                                if (error) {
                                    reject(new Error(error));
                                    return;
                                }
                            }
                            resolve({ objects: _objects, states: _states });
                        })().catch(reject);
                    },
                );
            })().catch(reject);
        });
    });
}

/** Stop all adapters and the js-controller again */
export async function stopIoBroker(): Promise<void> {
    const options = requireOptions();

    for (let a = 0; a < options.additionalAdapters.length; a++) {
        await setup.stopCustomAdapter(options.additionalAdapters[a].split('@')[0].replace('iobroker.', ''), 0);
    }

    if (options.startOwnAdapter) {
        await setup.stopCustomAdapter(options.widgetsSetName, 0);
    }

    // wait till adapters are stopped
    await new Promise<void>(resolve => setTimeout(resolve, 1000));

    await new Promise<void>(resolve =>
        setup.stopController(normalTerminated => {
            console.log(`Adapter normal terminated: ${normalTerminated}`);
            resolve();
        }),
    );
}

/**
 * Open the editor of the GUI adapter and create the default project in it.
 *
 * @param page page of the editor
 * @param timeout how long to wait for the dialog and for the loaded editor
 */
export async function createProject(page?: Page | null, timeout?: number): Promise<void> {
    const options = requireOptions();
    const usedPage = requirePage(page);

    if (options.mainGuiProject) {
        await usedPage.goto(`http://127.0.0.1:18082/${options.mainGuiProject}/edit.html`, {
            waitUntil: 'domcontentloaded',
        });
        if (options.mainGuiProject.startsWith('vis')) {
            await usedPage.waitForSelector('#create_new_project', { timeout: timeout || 10000 });
            await usedPage.click('#create_new_project');
        }
    }

    // Create directory
    if (!existsSync(`${rootDir}tmp/screenshots`)) {
        mkdirSync(`${rootDir}tmp/screenshots`);
    }
    await usedPage.screenshot({ path: `${rootDir}tmp/screenshots/00_create-project.png` });

    // create the default project
    if (options.mainGuiProject?.startsWith('vis')) {
        await usedPage.waitForSelector('#create_new_project_ok_buton');
        await usedPage.click('#create_new_project_ok_buton');
        await usedPage.waitForSelector('#summary_tabs', { timeout: timeout || 60000 }); // tabs are always visible
        await usedPage.screenshot({ path: `${rootDir}tmp/screenshots/01_loaded.png` });
    }
}

/**
 * Close the browser again.
 *
 * @param browser browser to close; the browser of `startBrowser` is used when it is missing
 */
export async function stopBrowser(browser?: Browser | null): Promise<void> {
    const usedBrowser = browser || gBrowser;
    if (!usedBrowser) {
        throw new Error('startBrowser() must be called first');
    }
    await usedBrowser.close();
}

/**
 * Wait until the adapter has finished uploading its files.
 *
 * A cold start uploads everything the adapter ships - for vis-2 that is tens of megabytes - and how long that
 * takes depends on the machine. The former twenty tries, a hard-wired ten seconds, were not enough on a slower
 * one: the wait ran out, the browser was opened on an editor that was not ready, and the test then failed
 * somewhere else entirely. `visUploadedTimeoutMs` sets the budget, and the default is generous.
 *
 * @param statesClient states client of the controller
 * @param cb called with nothing when the upload is done, with a message when not
 * @param counter how many tries are left; only the recursion passes this
 */
export function checkIsVisUploaded(statesClient: StatesClient, cb?: (error?: string) => void, counter?: number): void {
    const options = requireOptions();
    const visUploadedId = options.visUploadedId;

    if (!visUploadedId) {
        cb?.('No GUI adapter is installed, so there is nothing that could be uploaded');
        return;
    }

    const triesLeft = counter === undefined ? Math.ceil((options.visUploadedTimeoutMs || 120_000) / 500) : counter;

    if (triesLeft === 0) {
        cb?.(`Timeout: ${visUploadedId} was still not set - the adapter did not finish uploading`);
        return;
    }

    // the client resolves its promise as well as calling the callback; only the callback is of interest here
    void statesClient.getState(visUploadedId, (err: Error | null | undefined, state?: ioBroker.State | null): void => {
        console.log(`[${triesLeft}]Check if vis is uploaded ${visUploadedId} = ${JSON.stringify(state)}`);
        err && console.error(err);
        if (state?.val) {
            cb?.();
        } else {
            setTimeout(() => checkIsVisUploaded(statesClient, cb, triesLeft - 1), 500);
        }
    });
}

/**
 * Wait until the adapter has finished uploading its files.
 *
 * @param statesClient states client of the controller
 * @param counter how many tries are left
 * @returns nothing when the upload is done, the message when it did not happen in time
 */
export function checkIsVisUploadedAsync(statesClient: StatesClient, counter?: number): Promise<string | undefined> {
    return new Promise<string | undefined>(resolve => checkIsVisUploaded(statesClient, resolve, counter));
}

/**
 * Put a widget on the view without touching the palette.
 *
 * @param page page of the editor
 * @param widgetName name of the widget in the palette, e.g. `tplValueString`
 * @param timeout how long to wait for the palette entry and for the new widget
 * @returns the ID of the widget that was created
 */
async function addWidget(page: Page | null | undefined, widgetName: string, timeout?: number): Promise<string> {
    const usedPage = requirePage(page);
    await usedPage.waitForSelector(`#widget_${widgetName}`, { timeout: timeout || 5000 });

    const wid = await usedPage.evaluate(
        async (_widgetName: string): Promise<string> =>
            await (
                window as unknown as { visAddWidget: (name: string, x: number, y: number) => Promise<string> }
            ).visAddWidget(_widgetName, 0, 0),
        widgetName,
    );

    await usedPage.waitForSelector(`#${wid}`, { timeout: timeout || 2000 });
    return wid;
}

/**
 * Put a widget on the view by really dragging it out of the palette.
 *
 * `addWidget` calls `window.visAddWidget` instead, which is quicker and enough for a test that only needs a
 * widget to be there - but it walks past the whole drag and drop of the editor. That path runs on react-dnd
 * with its HTML5 backend, which listens to the native drag events, so an earlier attempt here with
 * `mouse.down`, a few `mouse.move`s and a `mouse.up` could never work: those are mouse events and no
 * `dragstart` is among them. Puppeteer sends the real ones, but only once drag interception is switched on.
 *
 * @param page page of the editor
 * @param widgetName name of the widget in the palette, e.g. `tplValueString`
 * @param timeout how long to wait for the new widget to appear
 * @returns the ID of the widget that was created
 */
async function dragWidgetToView(page: Page | null | undefined, widgetName: string, timeout?: number): Promise<string> {
    const usedPage = requirePage(page);

    const widgetIds = (): Promise<string[]> =>
        usedPage.evaluate(() => [...document.querySelectorAll('.vis-widget')].map(el => el.id));
    const before = await widgetIds();

    const source = await usedPage.waitForSelector(`#widget_${widgetName}`, { timeout: timeout || 5000 });
    const target = await usedPage.waitForSelector('#vis-react-container', { timeout: timeout || 5000 });
    if (!source || !target) {
        throw new Error(`Cannot find "${widgetName}" in the palette or the view to drop it on`);
    }

    await usedPage.setDragInterception(true);
    try {
        await source.dragAndDrop(target);
        // the drop writes the project, and the widget arrives with the next render
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
    } finally {
        // leave the page as it was found, whatever happened
        await usedPage.setDragInterception(false);
    }

    const added = (await widgetIds()).filter(id => !before.includes(id));
    if (added.length !== 1) {
        throw new Error(
            `Dragging "${widgetName}" out of the palette put ${added.length} widgets on the view, expected one`,
        );
    }

    return added[0];
}

/**
 * Select a widget on the view and delete it.
 *
 * @param page page of the editor
 * @param wid ID of the widget, e.g. `w00001`
 * @param timeout how long to wait for the confirmation dialog
 */
async function deleteWidget(page: Page | null | undefined, wid: string, timeout?: number): Promise<void> {
    const usedPage = requirePage(page);
    // select widget
    await usedPage.click(`#${wid}`);
    await usedPage.keyboard.press('Delete');
    await usedPage.waitForSelector(`#ar_dialog_confirm_ok_deleteDialog`, { timeout: timeout || 2000 });
    await usedPage.click('#ar_dialog_confirm_ok_deleteDialog');
}

/**
 * Expand a widget set in the palette.
 *
 * @param page page of the editor
 * @param widgetSetName name of the widget set, e.g. `vis-2-widgets-material`
 * @param timeout how long to wait for the widget set
 */
async function openWidgetSet(page: Page | null | undefined, widgetSetName: string, timeout?: number): Promise<void> {
    const usedPage = requirePage(page);
    const el = await usedPage.waitForSelector(`#summary_${widgetSetName}`, { timeout: timeout || 2000 });
    if (!el) {
        throw new Error(`Cannot find the widget set "${widgetSetName}" in the palette`);
    }

    const className = await (await el.getProperty('className')).jsonValue();
    if (!className.includes('vis-palette-summary-expanded')) {
        await usedPage.click(`#summary_${widgetSetName}`);
    }
}

/**
 * Collapse a widget set in the palette again.
 *
 * @param page page of the editor
 * @param widgetSetName name of the widget set, e.g. `vis-2-widgets-material`
 * @param timeout how long to wait for the widget set
 */
async function closeWidgetSet(page: Page | null | undefined, widgetSetName: string, timeout?: number): Promise<void> {
    const usedPage = requirePage(page);
    try {
        const el = await usedPage.waitForSelector(`#summary_${widgetSetName}`, { timeout: timeout || 1000 });
        const className = await (await el?.getProperty('className'))?.jsonValue();
        if (className?.includes('vis-palette-summary-expanded')) {
            await usedPage.click(`#summary_${widgetSetName}`);
        }
    } catch (e) {
        // ignore error
        console.log(`Cannot close widget set: ${e as Error}`);
    }
}

/**
 * Store a screenshot of the page in `tmp/screenshots`.
 *
 * @param page page to take the picture of
 * @param fileName name of the file, without the `.png`
 */
export async function screenshot(page: Page | null | undefined, fileName: string): Promise<void> {
    const usedPage = requirePage(page);
    await usedPage.screenshot({ path: `${rootDir}tmp/screenshots/${fileName}.png` });
}

/**
 * Read the names of all widgets of one widget set from the palette.
 *
 * @param page page of the editor
 * @param widgetSetName name of the widget set, e.g. `vis-2-widgets-material`
 * @returns the names of the widgets, e.g. `tplMaterial2Switches`
 */
async function getListOfWidgets(page: Page | null | undefined, widgetSetName: string): Promise<string[]> {
    const usedPage = requirePage(page);
    const widgets = await usedPage.$$(`.widget-${widgetSetName}`);
    const result: string[] = [];
    for (let w = 0; w < widgets.length; w++) {
        const wid = await (await widgets[w].getProperty('id')).jsonValue();
        result.push(wid.substring('widget_'.length));
    }
    return result;
}

/**
 * Read the names of all widget sets in the palette.
 *
 * @param page page of the editor
 * @returns the names of the widget sets, e.g. `vis-2-widgets-material`
 */
async function getListOfWidgetSets(page?: Page | null): Promise<string[]> {
    const usedPage = requirePage(page);
    const widgets = await usedPage.$$(`.vis-palette-widget-set`);
    const result: string[] = [];
    for (let w = 0; w < widgets.length; w++) {
        const wid = await (await widgets[w].getProperty('id')).jsonValue();
        result.push(wid.substring('summary_'.length));
    }
    return result;
}

/**
 * Get told about every state that changes while the controller runs.
 *
 * @param cb handler for the changes, `null` to stop listening
 */
export function setOnStateChanged(cb: StateChangeHandler | null): void {
    onStateChanged = cb;
}

/** Everything that works on the palette of the editor */
export const palette = {
    addWidget,
    dragWidgetToView,
    openWidgetSet,
    getListOfWidgets,
    closeWidgetSet,
    getListOfWidgetSets,
};

/** Everything that works on the view of the editor */
export const view = {
    deleteWidget,
};
