const { withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withMinSdk(config) {
  return withAndroidManifest(config, async (config) => {
    const manifest = config.modResults;
    if (!manifest.manifest.$) {
      manifest.manifest.$ = {};
    }
    if (!manifest.manifest['uses-sdk']) {
      manifest.manifest['uses-sdk'] = [];
    }
    manifest.manifest['uses-sdk'] = [{
      '$': {
        'xmlns:tools': 'http://schemas.android.com/tools',
        'tools:overrideLibrary': 'com.goodcom.react.EzPrinter'
      }
    }];
    return config;
  });
};