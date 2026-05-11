const { withAppBuildGradle, withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withMinSdk(config) {
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      'minSdkVersion rootProject.ext.minSdkVersion',
      'minSdkVersion 26'
    );
    return config;
  });

  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    manifest['uses-sdk'] = [{
      '$': {
        'android:minSdkVersion': '26',
        'tools:overrideLibrary': 'com.goodcom.react.EzPrinter'
      }
    }];
    return config;
  });

  return config;
};