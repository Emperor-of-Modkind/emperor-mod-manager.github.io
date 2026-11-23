import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildManifest, classifyAsset } from "./build-release-manifest.mjs";

describe("build-release-manifest mobile APK classification", () => {
  it("returns an empty mobile array when no APK is in the release", () => {
    const manifest = buildManifest({
      tag_name: "v0.8.5",
      assets: [
        {
          name: "Emperor.Mod.Manager_0.8.5_x64-setup.exe",
          browser_download_url: "https://example.com/setup.exe",
          size: 12345,
        },
        {
          name: "Emperor.Mod.Manager_0.8.5_amd64.AppImage",
          browser_download_url: "https://example.com/app.AppImage",
          size: 67890,
        },
      ],
    });

    assert.deepEqual(manifest.platforms.mobile, []);
    assert.equal(manifest.platforms.windows.length, 1);
    assert.equal(manifest.platforms.linux.length, 1);
  });

  it("classifies a single universal APK as recommended", () => {
    const manifest = buildManifest({
      tag_name: "v0.9.0",
      assets: [
        {
          name: "emperor-mod-manager-0.9.0.apk",
          browser_download_url: "https://example.com/emperor-mod-manager-0.9.0.apk",
          size: 18500000,
        },
      ],
    });

    assert.equal(manifest.platforms.mobile.length, 1);
    assert.equal(manifest.platforms.mobile[0].label, "Android App (.apk)");
    assert.equal(manifest.platforms.mobile[0].recommended, true);
    assert.equal(manifest.platforms.mobile[0].url, "https://example.com/emperor-mod-manager-0.9.0.apk");
  });

  it("sorts multiple APKs with universal first and promotes ARM64 when no universal APK exists", () => {
    const multi = buildManifest({
      tag_name: "v0.9.0",
      assets: [
        {
          name: "emperor-0.9.0-x86_64.apk",
          browser_download_url: "https://example.com/x86_64.apk",
          size: 100,
        },
        {
          name: "emperor-0.9.0-arm64-v8a.apk",
          browser_download_url: "https://example.com/arm64.apk",
          size: 200,
        },
        {
          name: "emperor-0.9.0-universal.apk",
          browser_download_url: "https://example.com/universal.apk",
          size: 300,
        },
      ],
    });

    assert.deepEqual(
      multi.platforms.mobile.map((a) => a.name),
      [
        "emperor-0.9.0-universal.apk",
        "emperor-0.9.0-arm64-v8a.apk",
        "emperor-0.9.0-x86_64.apk",
      ],
    );
    assert.equal(multi.platforms.mobile[0].recommended, true);
    assert.equal(multi.platforms.mobile[1].recommended, false);

    const armOnly = buildManifest({
      tag_name: "v0.9.0",
      assets: [
        {
          name: "emperor-0.9.0-arm64-v8a.apk",
          browser_download_url: "https://example.com/arm64.apk",
          size: 200,
        },
      ],
    });

    assert.equal(armOnly.platforms.mobile.length, 1);
    assert.equal(armOnly.platforms.mobile[0].label, "Android App (ARM64 .apk)");
    assert.equal(armOnly.platforms.mobile[0].recommended, true);
  });

  it("ignores unrelated assets", () => {
    assert.equal(classifyAsset({ name: "README.txt", browser_download_url: "https://example.com/r", size: 10 }), null);
  });
});
