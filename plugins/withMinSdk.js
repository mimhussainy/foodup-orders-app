const { withAppBuildGradle, withAndroidManifest } = require('@expo/config-plugins');

module.exports = function withMinSdk(config) {
  // Fix build.gradle
  config = withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      'minSdkVersion rootProject.ext.minSdkVersion',
      'minSdkVersion 26'
    );
    return config;
  });

  // Fix AndroidManifest.xml
  config = withAndroidManifest(config, (config) => {
    const manifest = config.modResults.manifest;
    if (!manifest['uses-sdk']) {
      manifest['uses-sdk'] = [];
    }
    manifest['uses-sdk'] = [{
      '$': {
        'xmlns:tools': 'http://schemas.android.com/tools',
        'android:minSdkVersion': '26',
        'tools:overrideLibrary': 'com.goodcom.react.EzPrinter'
      }
    }];
    return config;
  });

  return config;
};