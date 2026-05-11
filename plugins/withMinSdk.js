const { withAppBuildGradle } = require('@expo/config-plugins');

module.exports = function withMinSdk(config) {
  return withAppBuildGradle(config, (config) => {
    config.modResults.contents = config.modResults.contents.replace(
      'minSdkVersion rootProject.ext.minSdkVersion',
      'minSdkVersion 26'
    );
    return config;
  });
};