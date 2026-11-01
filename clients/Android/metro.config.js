const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const sharedLib = path.resolve(projectRoot, "../../lib"); // adjust to where your times.ts lives

const config = getDefaultConfig(projectRoot);

// Let Metro see the shared folder, and still find the app's own node_modules.
config.watchFolders = [sharedLib];
config.resolver.nodeModulesPaths = [path.resolve(projectRoot, "node_modules")];

module.exports = config;
