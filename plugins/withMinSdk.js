const { withAppBuildGradle, withAndroidManifest, withProjectBuildGradle, withDangerousMod } = require('@expo/config-plugins');

function withMinSdkBuildGradle(config) {
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = mod.modResults.contents.replace(
      /minSdkVersion\s+\d+/g,
      'minSdkVersion 26'
    );
    return mod;
  });
}

function withMinSdkRootGradle(config) {
  return withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = mod.modResults.contents.replace(
      /minSdk\s*=?\s*24/g,
      'minSdk = 26'
    );
    return mod;
  });
}

function withMinSdkManifest(config) {
  return withAndroidManifest(config, (mod) => {
    const manifest = mod.modResults.manifest;
    if (!manifest.$['xmlns:tools']) {
      manifest.$['xmlns:tools'] = 'http://schemas.android.com/tools';
    }
    if (!manifest['uses-sdk']) {
      manifest['uses-sdk'] = [{}];
    }
    manifest['uses-sdk'][0].$ = manifest['uses-sdk'][0].$ || {};
    manifest['uses-sdk'][0].$['android:minSdkVersion'] = '26';
    manifest['uses-sdk'][0].$['tools:overrideLibrary'] = 'com.goodcom.react.EzPrinter';
    return mod;
  });
}

function withAdiRegistration(config) {
  return withDangerousMod(config, [
    'android',
    async (mod) => {
      const fs = require('fs');
      const path = require('path');
      const assetsDir = path.join(mod.modRequest.platformProjectRoot, 'app', 'src', 'main', 'assets');
      fs.mkdirSync(assetsDir, { recursive: true });
      fs.writeFileSync(
        path.join(assetsDir, 'adi-registration.properties'),
        'DWMVUF33WHJLKAAAAAAAAAAAAA'
      );
      return mod;
    },
  ]);
}

module.exports = function withMinSdk(config) {
  config = withMinSdkBuildGradle(config);
  config = withMinSdkRootGradle(config);
  config = withMinSdkManifest(config);
  config = withAdiRegistration(config);
  return config;
};