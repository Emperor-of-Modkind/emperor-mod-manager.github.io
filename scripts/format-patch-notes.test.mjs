import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanForEndUsers,
  collateReleaseCommits,
  isNoiseCommit,
  parseCommitMessage,
} from "./format-patch-notes.mjs";

describe("cleanForEndUsers", () => {
  it("strips code-only parentheticals while keeping human-readable ones", () => {
    assert.equal(
      cleanForEndUsers("P2P Friends (p2p/mod.rs)", { isHeading: true }),
      "P2P Friends",
    );
    assert.equal(
      cleanForEndUsers(
        "Rich grid cards for collection mod lists (CollectionDetailView, resolve_share_mod_metadata)",
        { isHeading: true },
      ),
      "Rich grid cards for collection mod lists",
    );
    assert.equal(
      cleanForEndUsers(
        "Added browse grid size (120–280 px, default 160) with debounced saving",
      ),
      "Added browse grid size (120–280 px, default 160) with debounced saving.",
    );
    assert.equal(
      cleanForEndUsers(
        "Replaced toggles with per-collection visibility modes (private, all friends, or selected friends via set_collection_sharing)",
      ),
      "Replaced toggles with per-collection visibility modes (private, all friends, or selected friends).",
    );
  });

  it("preserves user-facing modding terms and protocols", () => {
    const cleaned = cleanForEndUsers(
      "registers nxm:// and emperor:// handlers for AppImage and Proton users",
    );
    assert.match(cleaned, /nxm:\/\//);
    assert.match(cleaned, /emperor:\/\//);
    assert.match(cleaned, /AppImage/);
    assert.match(cleaned, /Proton/);
  });

  it("cleans internal file paths and Rust cfg macros", () => {
    assert.equal(
      cleanForEndUsers("Added hover styling in App.css"),
      "Added hover styling.",
    );
    assert.equal(
      cleanForEndUsers("Gated Windows-only items behind #[cfg(windows)] to fix warnings"),
      "Gated Windows-only items to fix warnings.",
    );
  });
});

describe("isNoiseCommit", () => {
  it("identifies lockfile and merge commits as noise", () => {
    assert.equal(isNoiseCommit("Update Cargo.lock"), true);
    assert.equal(isNoiseCommit("Merge pull request #42 from user/branch"), true);
    assert.equal(isNoiseCommit("v0.8.5"), true);
    assert.equal(isNoiseCommit("webview fixes"), false);
  });
});

describe("parseCommitMessage & collateReleaseCommits", () => {
  it("parses structured v0.8.x release commits with headings, colons, and sub-items", () => {
    const message = `0.8.1 - performance improvements and cleanup

FOMOD & Mod Staging
Live FOMOD condition evaluation: FomodDialog now re-queries the backend as options are toggled so conditional steps update live.
Scroll & animation performance:
Added fast-scroll settling (FAST_SCROLL_SETTLE_MS) in BrowseResults.tsx.
Tuned imageLoadQueue.ts to LIFO (pop()) for smoother fade-ins.
P2P Friends (p2p/mod.rs)
Automatic presence & keepalive: Added initial friend sync on startup.`;

    const result = collateReleaseCommits([
      { message: "Update Cargo.lock" },
      { message },
    ]);

    assert.equal(result.headline, "Performance improvements and cleanup");
    assert.equal(result.commitCount, 2);
    assert.equal(result.sections.length, 2);
    assert.equal(result.sections[0].title, "FOMOD & Mod Staging");
    assert.equal(result.sections[0].items.length, 2);
    assert.equal(result.sections[0].items[0].title, "Live FOMOD condition evaluation");
    assert.equal(result.sections[0].items[1].title, "Scroll & animation performance");
    assert.equal(result.sections[0].items[1].subitems.length, 2);
    assert.equal(result.sections[1].title, "P2P Friends");
  });

  it("parses lead-title period format and placeholder subjects like 'see desc'", () => {
    const message = `see desc

Project Zomboid. Mods deploy to the user Zomboid/mods folder (~/Zomboid, %USERPROFILE%\\Zomboid, or Proton compatdata/108600).
id Tech. Support for DOOM (2016), Eternal, and The Dark Ages.`;

    const parsed = parseCommitMessage(message);
    assert.equal(parsed.sections.length, 1);
    assert.equal(parsed.sections[0].title, "Highlights");
    assert.equal(parsed.sections[0].items[0].title, "Project Zomboid");
    assert.equal(parsed.sections[0].items[1].title, "id Tech");
  });

  it("splits and categorizes terse v0.5.x single-line commits", () => {
    const result = collateReleaseCommits([
      { message: "webview fixes" },
      { message: "improved webview + added log in prompt from settings" },
      { message: "image carousel improvements + init dressmaker support" },
    ]);

    const titles = result.sections.map((s) => s.title);
    assert.deepEqual(titles, ["New Features", "Improvements", "Bug Fixes"]);
    const features = result.sections[0].items.map((i) => i.description);
    assert.ok(features.some((d) => d.includes("Added log in prompt from settings.")));
    assert.ok(features.some((d) => d.includes("Initial dressmaker support.")));
  });
});
