#!/usr/bin/env node
/**
 * Builds data/latest-release.json from a GitHub Releases API JSON payload.
 *
 * Usage:
 *   node scripts/build-release-manifest.mjs < release.json
 *   node scripts/build-release-manifest.mjs --input release.json --output data/latest-release.json
 */

import fs from "node:fs";
import path from "node:path";

const DEFAULT_OUTPUT = path.resolve("data/latest-release.json");

function parseArgs(argv) {
  let input = null;
  let output = DEFAULT_OUTPUT;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--input" && argv[i + 1]) {
      input = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      output = path.resolve(argv[++i]);
    }
  }
  return { input, output };
}

export function classifyAsset(asset) {
  const name = String(asset.name || "");
  const lower = name.toLowerCase();

  const base = {
    name,
    url: asset.browser_download_url,
    size: Number(asset.size || 0),
    digest: asset.digest || null,
  };

  if (lower === "sha256sums" || lower.endsWith(".sha256") || lower.endsWith(".sha256sums")) {
    return {
      bucket: "checksums",
      item: {
        ...base,
        label: "SHA256 Checksums",
        description: "Verify downloaded files.",
        recommended: false,
        order: 99,
      },
    };
  }

  // Windows installers & binaries
  if (lower.endsWith("-setup.exe") || lower.includes("setup.exe")) {
    return {
      bucket: "windows",
      item: {
        ...base,
        label: "Windows Installer (x64 NSIS)",
        description: "Recommended. Installs WebView2 if needed and registers nxm:// and emperor:// links.",
        recommended: true,
        order: 1,
      },
    };
  }
  if (lower.endsWith(".msi")) {
    return {
      bucket: "windows",
      item: {
        ...base,
        label: "Windows MSI Package (x64)",
        description: "Standard Windows Installer (.msi) for Windows 10/11.",
        recommended: false,
        order: 2,
      },
    };
  }
  if (lower.endsWith(".exe")) {
    return {
      bucket: "windows",
      item: {
        ...base,
        label: "Standalone Executable (.exe)",
        description: "Portable binary with no installer. Doesn't register protocol links.",
        recommended: false,
        order: 3,
      },
    };
  }

  // Linux packages & binaries
  if (lower.endsWith(".appimage")) {
    return {
      bucket: "linux",
      item: {
        ...base,
        label: "Linux AppImage (x86_64)",
        description: "Portable package that runs on most distros. Supports in-app updates.",
        recommended: true,
        order: 1,
      },
    };
  }
  if (lower.endsWith(".deb")) {
    return {
      bucket: "linux",
      item: {
        ...base,
        label: "Debian / Ubuntu Package (.deb)",
        description: "Native .deb package for Debian, Ubuntu, Pop!_OS, and Linux Mint.",
        recommended: false,
        order: 2,
      },
    };
  }
  if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    return {
      bucket: "linux",
      item: {
        ...base,
        label: "Linux Tarball (.tar.gz)",
        description: "Contains the binary, .desktop file, and icons.",
        recommended: false,
        order: 3,
      },
    };
  }
  if (lower === "pkgbuild") {
    return {
      bucket: "linux",
      item: {
        ...base,
        label: "Arch Linux PKGBUILD",
        description: "Build a pacman package for Arch, CachyOS, EndeavourOS, or Manjaro using makepkg -si.",
        recommended: false,
        order: 4,
      },
    };
  }
  if (lower === "emperor-mod-manager") {
    return {
      bucket: "linux",
      item: {
        ...base,
        label: "Standalone Linux Binary",
        description: "Raw x86_64 binary.",
        recommended: false,
        order: 5,
      },
    };
  }

  // Android / Mobile APK
  if (lower.endsWith(".apk")) {
    if (lower.includes("arm64") || lower.includes("aarch64")) {
      return {
        bucket: "mobile",
        item: {
          ...base,
          label: "Android App (ARM64 .apk)",
          description: "For most modern 64-bit Android phones and tablets.",
          recommended: false,
          order: 2,
        },
      };
    }
    if (lower.includes("armeabi") || lower.includes("armv7")) {
      return {
        bucket: "mobile",
        item: {
          ...base,
          label: "Android App (ARMv7 .apk)",
          description: "For older 32-bit ARM Android devices.",
          recommended: false,
          order: 3,
        },
      };
    }
    if (lower.includes("x86_64") || lower.includes("x86")) {
      return {
        bucket: "mobile",
        item: {
          ...base,
          label: "Android App (x86 .apk)",
          description: "For x86 / x86_64 Android devices and emulators.",
          recommended: false,
          order: 4,
        },
      };
    }
    return {
      bucket: "mobile",
      item: {
        ...base,
        label: "Android App (.apk)",
        description: "Recommended. Install directly on Android devices.",
        recommended: true,
        order: 1,
      },
    };
  }

  return null;
}

export function buildManifest(release) {
  if (!release || !release.tag_name) {
    throw new Error("Invalid GitHub release payload: missing tag_name");
  }

  const buckets = {
    windows: [],
    linux: [],
    mobile: [],
    checksums: [],
  };

  for (const asset of release.assets || []) {
    const classified = classifyAsset(asset);
    if (classified) {
      buckets[classified.bucket].push(classified.item);
    }
  }

  buckets.windows.sort((a, b) => a.order - b.order);
  buckets.linux.sort((a, b) => a.order - b.order);
  buckets.mobile.sort((a, b) => a.order - b.order);
  if (buckets.mobile.length > 0 && !buckets.mobile.some((item) => item.recommended)) {
    buckets.mobile[0].recommended = true;
  }

  const stripOrder = ({ order, ...rest }) => rest;

  return {
    repo: "Emperor-of-Modkind/emperor-mod-manager",
    tag: release.tag_name,
    name: release.name || release.tag_name,
    publishedAt: release.published_at || release.created_at || null,
    releaseUrl:
      release.html_url ||
      `https://github.com/Emperor-of-Modkind/emperor-mod-manager/releases/tag/${release.tag_name}`,
    body: release.body || "",
    generatedAt: new Date().toISOString(),
    platforms: {
      windows: buckets.windows.map(stripOrder),
      linux: buckets.linux.map(stripOrder),
      mobile: buckets.mobile.map(stripOrder),
    },
    checksums: buckets.checksums.map(stripOrder),
  };
}

function main() {
  const { input, output } = parseArgs(process.argv.slice(2));
  const raw = input ? fs.readFileSync(input, "utf8") : fs.readFileSync(0, "utf8");
  const jsonStart = raw.indexOf("{");
  const release = JSON.parse(jsonStart >= 0 ? raw.slice(jsonStart) : raw);
  const manifest = buildManifest(release);

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Wrote ${manifest.tag} manifest to ${output}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
