require.config({
    baseUrl: "./bower_components",
    shim: {
        // Libraries
        lodash: {
            exports: '_'
        }
    },
    packages: [
        {
            name: 'dcl',
            location: './dcl'   //points to bower_components/dcl
        },
        {
            name: 'wcDocker',
            location: '../Code'
        },
        {
            name: 'lodash',
            location: './lodash-compat'   //points to bower_components/dcl
        }
    ]
});

require.config({
    config: {}
});

//require docker
require([
    "wcDocker/docker",
    "wcDocker/splitter",
    "wcDocker/tabframe",
    "wcDocker/iframe",
    // "wcDocker/ThemeBuilder",
    "wcDocker/webview",
    "wcDocker/absolute"
], function (wcDocker, wcSplitter, wcTabFrame, wcIFrame, /* wcThemeBuilder, */wcWebView, wcAbsolute) {

    //export
    window['wcDocker'] = wcDocker;
    window['wcSplitter'] = wcSplitter;
    window['wcTabFrame'] = wcTabFrame;
    window['wcIFrame'] = wcIFrame;
    window['wcWebView'] = wcWebView;
    window['wcAbsolute'] = wcAbsolute;
    // window['wcThemeBuilder'] = wcThemeBuilder;
    console.log('exported wcDocker');
}, undefined, true);    // Force synchronous loading so we don't have to wait.