// Checks the App Store / Play basics of the Capacitor shell without Xcode.
// Run: npm test (from apps/mobile).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const plist = require('plist');
const here = dirname(fileURLToPath(import.meta.url));
const app = join(here, '..');
const iosApp = join(app, 'ios/App/App');
const read = (p) => readFileSync(join(app, p), 'utf8');

const config = JSON.parse(read('capacitor.config.json'));
const info = plist.parse(read('ios/App/App/Info.plist'));
const pbxproj = read('ios/App/App.xcodeproj/project.pbxproj');

test('loads the live Field Capture site and only keeps Atmosphere hosts in the app', () => {
  assert.equal(config.appId, 'com.atmosphere.fieldcapture');
  assert.equal(config.server.url, 'https://app.atmosphereteam.com');
  assert.deepEqual(config.server.allowNavigation, [
    'app.atmosphereteam.com',
    'platform.atmosphereteam.com',
  ]);
  assert.equal(config.server.cleartext, undefined);
  assert.equal(config.server.errorPath, 'offline.html');
  assert.ok(read('www/offline.html').includes('https://app.atmosphereteam.com/'));
  assert.ok(read('www/index.html').includes('https://app.atmosphereteam.com/'));
});

test('Info.plist: permission strings, encryption, versions, no background audio', () => {
  for (const key of [
    'NSCameraUsageDescription',
    'NSMicrophoneUsageDescription',
    'NSLocationWhenInUseUsageDescription',
    // Apple flags a missing Always string (ITMS-90683) even though the app
    // never asks for Always access; keep it as a purpose string only.
    'NSLocationAlwaysAndWhenInUseUsageDescription',
    'NSPhotoLibraryUsageDescription',
    'NSPhotoLibraryAddUsageDescription',
  ]) {
    assert.equal(typeof info[key], 'string', key);
    assert.ok(info[key].length > 20, key);
  }
  assert.equal(info.ITSAppUsesNonExemptEncryption, false);
  assert.equal(info.CFBundleShortVersionString, '$(MARKETING_VERSION)');
  assert.equal(info.CFBundleVersion, '$(CURRENT_PROJECT_VERSION)');
  assert.equal(info.CFBundleIdentifier, '$(PRODUCT_BUNDLE_IDENTIFIER)');
  assert.equal(info.UIBackgroundModes, undefined);
  assert.deepEqual(info.UISupportedInterfaceOrientations, ['UIInterfaceOrientationPortrait']);
  assert.equal(info.CFBundleDisplayName, 'Field Capture');
});

test('Xcode project: bundle id, version from build settings, no Team ID, iPhone, privacy manifest', () => {
  const count = (re) => (pbxproj.match(re) || []).length;
  assert.equal(count(/PRODUCT_BUNDLE_IDENTIFIER = com\.atmosphere\.fieldcapture;/g), 2);
  assert.equal(count(/MARKETING_VERSION = [0-9]+\.[0-9]+\.[0-9]+;/g), 2);
  assert.equal(count(/CURRENT_PROJECT_VERSION = [0-9]+;/g), 2);
  assert.equal(count(/DEVELOPMENT_TEAM = "";/g), 2);
  assert.equal(count(/DEVELOPMENT_TEAM = [A-Z0-9]{10};/g), 0);
  assert.equal(count(/CODE_SIGN_STYLE = Automatic;/g), 2);
  assert.equal(count(/TARGETED_DEVICE_FAMILY = 1;/g), 2);
  assert.match(pbxproj, /PrivacyInfo\.xcprivacy in Resources \*\/,/);
});

test('PrivacyInfo.xcprivacy declares collected data and required-reason APIs, no tracking', () => {
  const manifest = plist.parse(readFileSync(join(iosApp, 'PrivacyInfo.xcprivacy'), 'utf8'));
  assert.equal(manifest.NSPrivacyTracking, false);
  assert.deepEqual(manifest.NSPrivacyTrackingDomains, []);
  const types = manifest.NSPrivacyCollectedDataTypes.map((d) => d.NSPrivacyCollectedDataType);
  for (const t of [
    'NSPrivacyCollectedDataTypeEmailAddress',
    'NSPrivacyCollectedDataTypeName',
    'NSPrivacyCollectedDataTypeUserID',
    'NSPrivacyCollectedDataTypePreciseLocation',
    'NSPrivacyCollectedDataTypeAudioData',
    'NSPrivacyCollectedDataTypePhotosorVideos',
    'NSPrivacyCollectedDataTypeOtherUserContent',
  ]) {
    assert.ok(types.includes(t), t);
  }
  for (const d of manifest.NSPrivacyCollectedDataTypes) {
    assert.equal(d.NSPrivacyCollectedDataTypeTracking, false);
    assert.equal(d.NSPrivacyCollectedDataTypeLinked, true);
  }
  const apis = manifest.NSPrivacyAccessedAPITypes.map((a) => a.NSPrivacyAccessedAPIType);
  assert.ok(apis.includes('NSPrivacyAccessedAPICategoryUserDefaults'));
});

/** PNG colour type lives at byte 25 (IHDR): 2 = RGB, 6 = RGBA. */
function pngColorType(path) {
  const buf = readFileSync(path);
  assert.equal(buf.toString('ascii', 12, 16), 'IHDR', path);
  return buf[25];
}

test('iOS app icon is 1024x1024 with no alpha channel', () => {
  const dir = join(iosApp, 'Assets.xcassets/AppIcon.appiconset');
  const contents = JSON.parse(readFileSync(join(dir, 'Contents.json'), 'utf8'));
  assert.ok(contents.images.length > 0);
  for (const image of contents.images) {
    const file = join(dir, image.filename);
    assert.equal(pngColorType(file), 2, image.filename);
    const buf = readFileSync(file);
    assert.equal(buf.readUInt32BE(16), 1024);
    assert.equal(buf.readUInt32BE(20), 1024);
  }
});

test('Android: same app id, camera/mic/location permissions', () => {
  const manifest = read('android/app/src/main/AndroidManifest.xml');
  for (const perm of [
    'CAMERA',
    'RECORD_AUDIO',
    'MODIFY_AUDIO_SETTINGS',
    'ACCESS_FINE_LOCATION',
    'ACCESS_COARSE_LOCATION',
  ]) {
    assert.ok(manifest.includes(`android.permission.${perm}"`), perm);
  }
  assert.match(read('android/app/build.gradle'), /applicationId "com\.atmosphere\.fieldcapture"/);
  const launcher = readdirSync(join(app, 'android/app/src/main/res/mipmap-xxxhdpi'));
  assert.ok(launcher.includes('ic_launcher.png'));
});

test('the app loads plugins the web bridge calls by name', () => {
  const pkg = JSON.parse(read('package.json'));
  for (const dep of [
    '@capacitor-community/keep-awake',
    '@capacitor/app',
    '@capacitor/geolocation',
  ]) {
    assert.ok(pkg.dependencies[dep], dep);
  }
  const bridge = readFileSync(join(app, '../../fieldcapture/js/native-bridge.js'), 'utf8');
  assert.match(bridge, /'KeepAwake', 'keepAwake'/);
  assert.match(bridge, /'KeepAwake', 'allowSleep'/);
  assert.match(bridge, /addListener\('App', 'pause'/);
  assert.match(bridge, /'Geolocation',\s*'watchPosition'/);
});

test('iPhone sizing: dark native background, no page scroll/bounce, keyboard resizes the web view', () => {
  assert.equal(config.backgroundColor, '#141311');
  assert.equal(config.ios.backgroundColor, '#141311');
  assert.equal(config.ios.contentInset, 'never');
  assert.equal(config.ios.scrollEnabled, false);
  assert.equal(config.plugins.Keyboard.resize, 'native');
  assert.equal(config.plugins.Keyboard.resizeOnFullScreen, true);
  const pkg = JSON.parse(read('package.json'));
  for (const dep of ['@capacitor/keyboard', '@capacitor/status-bar']) assert.ok(pkg.dependencies[dep], dep);
  const spm = read('ios/App/CapApp-SPM/Package.swift');
  assert.match(spm, /CapacitorKeyboard/);
  assert.match(spm, /CapacitorStatusBar/);
});
