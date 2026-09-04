import config from '@iobroker/eslint-config';

export default [
    ...config,
    {
        languageOptions: {
            parserOptions: {
                projectService: {
                    allowDefaultProject: ['*.mjs'],
                },
                tsconfigRootDir: import.meta.dirname,
            },
        },
    },
    {
        // The callbacks handed to `page.evaluate()` run in the browser, not in node, so `window` and
        // `document` are theirs. Without this every one of them is reported as an undefined global.
        languageOptions: {
            globals: {
                window: 'readonly',
                document: 'readonly',
            },
        },
    },
    {
        // disable temporary the rule 'jsdoc/require-param' and enable 'jsdoc/require-jsdoc'
        rules: {
            'jsdoc/require-jsdoc': 'off',
            'jsdoc/require-param': 'off',
        },
    },
    {
        ignores: ['build/**/*', '*.mjs'],
    },
];
