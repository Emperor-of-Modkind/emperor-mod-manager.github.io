// Dynamic Downloads page: loads GitHub Actions manifest (with live GitHub API fallback)
// and drives the accessible Windows / Linux / Mobile App platform switcher.

const REPO = "Emperor-of-Modkind/emperor-mod-manager";
const MANIFEST_URL = "./data/latest-release.json";
const GITHUB_API_URL = `https://api.github.com/repos/${REPO}/releases/latest`;
const FALLBACK_RELEASES_URL = `https://github.com/${REPO}/releases/latest`;

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return "";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let idx = 0;
  while (value >= 1024 && idx < units.length - 1) {
    value /= 1024;
    idx += 1;
  }
  return `${value.toFixed(idx === 0 ? 0 : 1)} ${units[idx]}`;
}

function formatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  }).format(date);
}

function detectInitialPlatform() {
  const params = new URLSearchParams(window.location.search);
  const queryPlatform = params.get("platform")?.toLowerCase();
  if (queryPlatform === "windows" || queryPlatform === "linux") {
    return queryPlatform;
  }
  if (queryPlatform === "mobile" || queryPlatform === "android") {
    return "mobile";
  }

  const uaPlatform = (navigator.userAgentData?.platform || navigator.platform || navigator.userAgent || "").toLowerCase();
  if (uaPlatform.includes("android") || (navigator.userAgent || "").toLowerCase().includes("android")) {
    return "mobile";
  }
  if (uaPlatform.includes("linux") || uaPlatform.includes("x11")) {
    return "linux";
  }
  return "windows";
}

function normalizeLiveRelease(release) {
  const windows = [];
  const linux = [];
  const mobile = [];
  const checksums = [];

  for (const asset of release.assets || []) {
    const name = String(asset.name || "");
    const lower = name.toLowerCase();
    const base = {
      name,
      url: asset.browser_download_url,
      size: Number(asset.size || 0),
    };

    if (lower === "sha256sums" || lower.endsWith(".sha256")) {
      checksums.push({ ...base, label: "SHA256 Checksums", description: "Verify downloaded files.", recommended: false });
    } else if (lower.endsWith("-setup.exe") || lower.includes("setup.exe")) {
      windows.push({
        ...base,
        label: "Windows Installer (x64 NSIS)",
        description: "Recommended. Installs WebView2 if needed and registers nxm:// and emperor:// links.",
        recommended: true,
        order: 1,
      });
    } else if (lower.endsWith(".msi")) {
      windows.push({
        ...base,
        label: "Windows MSI Package (x64)",
        description: "Standard Windows Installer (.msi) for Windows 10/11.",
        recommended: false,
        order: 2,
      });
    } else if (lower.endsWith(".exe")) {
      windows.push({
        ...base,
        label: "Standalone Executable (.exe)",
        description: "Portable binary with no installer. Doesn't register protocol links.",
        recommended: false,
        order: 3,
      });
    } else if (lower.endsWith(".appimage")) {
      linux.push({
        ...base,
        label: "Linux AppImage (x86_64)",
        description: "Portable package that runs on most distros. Supports in-app updates.",
        recommended: true,
        order: 1,
      });
    } else if (lower.endsWith(".deb")) {
      linux.push({
        ...base,
        label: "Debian / Ubuntu Package (.deb)",
        description: "Native .deb package for Debian, Ubuntu, Pop!_OS, and Linux Mint.",
        recommended: false,
        order: 2,
      });
    } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
      linux.push({
        ...base,
        label: "Linux Tarball (.tar.gz)",
        description: "Contains the binary, .desktop file, and icons.",
        recommended: false,
        order: 3,
      });
    } else if (lower === "pkgbuild") {
      linux.push({
        ...base,
        label: "Arch Linux PKGBUILD",
        description: "Build a pacman package for Arch, CachyOS, EndeavourOS, or Manjaro using makepkg -si.",
        recommended: false,
        order: 4,
      });
    } else if (lower === "emperor-mod-manager") {
      linux.push({
        ...base,
        label: "Standalone Linux Binary",
        description: "Raw x86_64 binary.",
        recommended: false,
        order: 5,
      });
    } else if (lower.endsWith(".apk")) {
      if (lower.includes("arm64") || lower.includes("aarch64")) {
        mobile.push({
          ...base,
          label: "Android App (ARM64 .apk)",
          description: "For most modern 64-bit Android phones and tablets.",
          recommended: false,
          order: 2,
        });
      } else if (lower.includes("armeabi") || lower.includes("armv7")) {
        mobile.push({
          ...base,
          label: "Android App (ARMv7 .apk)",
          description: "For older 32-bit ARM Android devices.",
          recommended: false,
          order: 3,
        });
      } else if (lower.includes("x86_64") || lower.includes("x86")) {
        mobile.push({
          ...base,
          label: "Android App (x86 .apk)",
          description: "For x86 / x86_64 Android devices and emulators.",
          recommended: false,
          order: 4,
        });
      } else {
        mobile.push({
          ...base,
          label: "Android App (.apk)",
          description: "Recommended. Install directly on Android devices.",
          recommended: true,
          order: 1,
        });
      }
    }
  }

  windows.sort((a, b) => a.order - b.order);
  linux.sort((a, b) => a.order - b.order);
  mobile.sort((a, b) => a.order - b.order);
  if (mobile.length > 0 && !mobile.some((item) => item.recommended)) {
    mobile[0].recommended = true;
  }

  return {
    repo: REPO,
    tag: release.tag_name,
    name: release.name || release.tag_name,
    publishedAt: release.published_at || release.created_at || null,
    releaseUrl: release.html_url || FALLBACK_RELEASES_URL,
    platforms: { windows, linux, mobile },
    checksums,
  };
}

async function fetchReleaseData() {
  // Primary source: static JSON manifest updated by GitHub Actions
  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (res.ok) {
      const data = await res.json();
      if (data && data.tag && data.platforms) {
        return data;
      }
    }
  } catch {
    // Fall through to live GitHub Releases API
  }

  // Fallback: direct GitHub Releases API lookup
  const apiRes = await fetch(GITHUB_API_URL, {
    headers: { Accept: "application/vnd.github+json" },
  });
  if (!apiRes.ok) {
    throw new Error(`GitHub API responded with ${apiRes.status}`);
  }
  const raw = await apiRes.json();
  return normalizeLiveRelease(raw);
}

function createAssetCard(asset) {
  const card = document.createElement("div");
  card.className = asset.recommended ? "asset-card is-primary" : "asset-card";

  const info = document.createElement("div");
  info.className = "asset-info";

  const titleRow = document.createElement("div");
  titleRow.className = "asset-title-row";

  const title = document.createElement("strong");
  title.textContent = asset.label || asset.name;
  titleRow.appendChild(title);

  if (asset.recommended) {
    const badge = document.createElement("span");
    badge.className = "pill pill-accent";
    badge.textContent = "Recommended";
    titleRow.appendChild(badge);
  }

  const sizeText = formatBytes(asset.size);
  if (sizeText) {
    const sizePill = document.createElement("span");
    sizePill.className = "pill";
    sizePill.textContent = sizeText;
    titleRow.appendChild(sizePill);
  }

  info.appendChild(titleRow);

  if (asset.description) {
    const desc = document.createElement("div");
    desc.className = "asset-meta";
    desc.textContent = asset.description;
    info.appendChild(desc);
  }

  const filename = document.createElement("div");
  filename.className = "asset-filename";
  filename.textContent = asset.name;
  info.appendChild(filename);

  const link = document.createElement("a");
  link.className = asset.recommended ? "btn btn-primary" : "btn btn-secondary";
  link.href = asset.url;
  link.rel = "noopener noreferrer";
  link.textContent = "Download";

  card.append(info, link);
  return card;
}

function renderPlatformAssets(container, assets, releaseUrl) {
  container.replaceChildren();
  if (!assets || assets.length === 0) {
    const note = document.createElement("div");
    note.className = "status-note";
    note.textContent = "No downloads were found for this OS in the latest release. ";
    const a = document.createElement("a");
    a.href = releaseUrl || FALLBACK_RELEASES_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "View all assets on GitHub";
    note.appendChild(a);
    container.appendChild(note);
    return;
  }

  for (const asset of assets) {
    container.appendChild(createAssetCard(asset));
  }
}

function renderMobileAssets(container, instructionsEl, assets) {
  container.replaceChildren();
  if (!assets || assets.length === 0) {
    if (instructionsEl) instructionsEl.hidden = true;

    const card = document.createElement("div");
    card.className = "coming-soon-card";

    const badge = document.createElement("span");
    badge.className = "pill pill-accent";
    badge.textContent = "Coming Soon";

    const title = document.createElement("h2");
    title.textContent = "Mobile App — Coming Soon";

    const desc = document.createElement("p");
    desc.textContent =
      "The Android mobile version of Emperor Mod Manager is currently in development. Once an APK is published in GitHub Releases, the direct download link will appear here automatically.";

    card.append(badge, title, desc);
    container.appendChild(card);
    return;
  }

  for (const asset of assets) {
    container.appendChild(createAssetCard(asset));
  }
  if (instructionsEl) instructionsEl.hidden = false;
}

function setupPlatformTabs() {
  const tablist = document.querySelector("[data-platform-tablist]");
  const panelsContainer = document.querySelector("[data-platform-panels]");
  if (!tablist || !panelsContainer) return;

  const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
  const panels = Array.from(panelsContainer.querySelectorAll('[role="tabpanel"]'));

  function selectPlatform(platform, { moveFocus = false } = {}) {
    for (const tab of tabs) {
      const selected = tab.dataset.platform === platform;
      tab.setAttribute("aria-selected", String(selected));
      tab.toggleAttribute("focusgroupstart", selected);
      tab.tabIndex = selected ? 0 : -1;
      if (selected && moveFocus) {
        tab.focus();
      }
    }

    for (const panel of panels) {
      const active = panel.dataset.platformPanel === platform;
      if (active) {
        panel.removeAttribute("hidden");
      } else {
        panel.hidden = "until-found";
      }
    }
  }

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      selectPlatform(tab.dataset.platform);
    });

    // Keyboard navigation fallback for browsers without native focusgroup support
    tab.addEventListener("keydown", (event) => {
      const idx = tabs.indexOf(tab);
      let nextIdx = null;
      if (event.key === "ArrowRight") nextIdx = (idx + 1) % tabs.length;
      else if (event.key === "ArrowLeft") nextIdx = (idx - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") nextIdx = 0;
      else if (event.key === "End") nextIdx = tabs.length - 1;

      if (nextIdx !== null) {
        event.preventDefault();
        selectPlatform(tabs[nextIdx].dataset.platform, { moveFocus: true });
      }
    });
  }

  // Sync tab selection when browser Find-in-Page matches text inside a hidden="until-found" panel
  panelsContainer.addEventListener("beforematch", (event) => {
    const matchedPanel = event.target.closest?.('[role="tabpanel"]');
    if (matchedPanel?.dataset.platformPanel) {
      selectPlatform(matchedPanel.dataset.platformPanel);
    }
  });

  selectPlatform(detectInitialPlatform());
}

async function initDownloads() {
  setupPlatformTabs();

  const versionEl = document.querySelector("[data-release-version]");
  const dateEl = document.querySelector("[data-release-date]");
  const notesLink = document.querySelector("[data-release-notes-link]");
  const checksumLink = document.querySelector("[data-checksums-link]");
  const windowsList = document.querySelector('[data-asset-list="windows"]');
  const linuxList = document.querySelector('[data-asset-list="linux"]');
  const mobileList = document.querySelector('[data-asset-list="mobile"]');
  const mobileInstructions = document.querySelector("[data-mobile-instructions]");

  try {
    const release = await fetchReleaseData();

    if (versionEl) versionEl.textContent = release.tag;
    if (dateEl) {
      const formatted = formatDate(release.publishedAt);
      dateEl.textContent = formatted ? `Published ${formatted}` : "";
    }
    if (notesLink && release.releaseUrl) {
      notesLink.href = release.releaseUrl;
    }

    const sha = release.checksums?.[0];
    if (checksumLink && sha?.url) {
      checksumLink.href = sha.url;
      checksumLink.hidden = false;
    }

    if (windowsList) renderPlatformAssets(windowsList, release.platforms.windows, release.releaseUrl);
    if (linuxList) renderPlatformAssets(linuxList, release.platforms.linux, release.releaseUrl);
    if (mobileList) renderMobileAssets(mobileList, mobileInstructions, release.platforms.mobile);
  } catch (err) {
    if (versionEl) versionEl.textContent = "Latest Release";
    if (dateEl) dateEl.textContent = "Couldn't load release info automatically.";

    const renderError = (el) => {
      if (!el) return;
      el.replaceChildren();
      const box = document.createElement("div");
      box.className = "status-note is-error";
      box.textContent = "Couldn't load downloads right now. ";
      const a = document.createElement("a");
      a.href = FALLBACK_RELEASES_URL;
      a.target = "_blank";
      a.rel = "noopener noreferrer";
      a.textContent = "Download directly from GitHub Releases";
      box.appendChild(a);
      el.appendChild(box);
    };

    renderError(windowsList);
    renderError(linuxList);
    renderError(mobileList);
    if (mobileInstructions) mobileInstructions.hidden = true;
    console.error("Failed to load release manifest:", err);
  }
}

initDownloads();
