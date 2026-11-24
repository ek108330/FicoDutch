import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

const appId = "io.github.ek108330.ficodutch";
const adbPath = process.env.FICODUTCH_ANDROID_ADB ?? "adb";
const [apk, output = "android/build/screenshots"] = process.argv.slice(2);
assert.ok(apk, "Usage : node android/smoke.mjs <apk> [captures]");
mkdirSync(output, { recursive: true });

function adb(...args) {
  return execFileSync(adbPath, args, { timeout: 25_000 });
}

function screen() {
  adb("shell", "uiautomator", "dump", "/sdcard/ficodutch-test-ui.xml");
  return adb("exec-out", "cat", "/sdcard/ficodutch-test-ui.xml").toString("utf8");
}

async function find(label, timeout = 30_000) {
  const end = Date.now() + timeout;
  let lastScreen;
  while (Date.now() < end) {
    try {
      lastScreen = screen();
      for (const node of lastScreen.matchAll(/<node [^>]+>/g)) {
        const name = node[0].match(/\b(?:text|content-desc)="([^"]*)"/g) ?? [];
        if (!name.some((value) => {
          const text = value.slice(value.indexOf('="') + 2, -1);
          return label instanceof RegExp ? label.test(text) : text === label;
        })) continue;
        const bounds = node[0].match(/bounds="\[(\d+),(\d+)]\[(\d+),(\d+)]"/);
        if (bounds) return bounds.slice(1).map(Number);
      }
    } catch {
      // The first Android accessibility snapshot can arrive before the WebView is ready.
    }
    await wait(500);
  }
  if (lastScreen) writeFileSync(join(output, "dernier-ecran.xml"), lastScreen);
  throw new Error(`Élément Android introuvable : ${label}`);
}

async function tap(label) {
  const [left, top, right, bottom] = await find(label);
  adb("shell", "input", "tap", String(Math.floor((left + right) / 2)), String(Math.floor((top + bottom) / 2)));
}

function capture(name) {
  const image = adb("exec-out", "screencap", "-p");
  assert.equal(image.subarray(1, 4).toString("ascii"), "PNG");
  writeFileSync(join(output, `${name}.png`), image);
}

let playing = false;
try {
  assert.match(adb("install", "-r", apk).toString(), /Success/);
  adb("shell", "am", "force-stop", appId);
  adb("shell", "am", "start", "-W", "-n", `${appId}/.MainActivity`);
  await find("Créer un Hub", 120_000);
  capture("01-accueil-android");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await find("Créer un Hub");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await find("Créer un Hub");
  await tap("Mes stats");
  await find("Identifiant");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await find("Créer un Hub");

  await tap("Pseudo");
  adb("shell", "input", "text", "TestFicoAndroid");
  await tap("Créer un Hub");
  await tap("Ajouter un bot");
  const botName = /^(?:Bot \d+|ChaBotté|BotEnTrain|HarryBotter|Botus|RobinDesBots|Botman|Botzilla|JamesBot|SherlockBot|ValteriBotAs)$/;
  await find(botName);
  capture("02-hub-android");
  await tap("Lancer la partie");
  playing = true;
  await find("Mémorisation");
  capture("03-table-portrait");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await find("TestFicoAndroid");
  adb("shell", "input", "keyevent", "KEYCODE_BACK");
  await find("TestFicoAndroid");

  adb("shell", "settings", "put", "system", "accelerometer_rotation", "0");
  adb("shell", "settings", "put", "system", "user_rotation", "1");
  await wait(1_000);
  await find(botName);
  capture("04-table-paysage");
  assert.match(adb("shell", "dumpsys", "activity", "activities").toString(), /(?:topResumedActivity|mResumedActivity)[^\n]+ficodutch/);
  console.log("APK Android installé, Hub créé et manche lancée avec un bot.");
} catch (error) {
  capture("echec-android");
  throw error;
} finally {
  try {
    adb("shell", "settings", "put", "system", "user_rotation", "0");
    if (playing) {
      await tap("Paramètres du jeu");
      await tap("Gérer la table");
      await tap("Interrompre la partie");
      await tap("Confirmer l’interruption");
    }
  } catch {
    // This test owns its Hub. The server expires it after the host disconnects.
  }
  adb("shell", "am", "force-stop", appId);
}
