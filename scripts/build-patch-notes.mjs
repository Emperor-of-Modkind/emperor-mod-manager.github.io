#!/usr/bin/env node
/**
 * Builds data/patch-notes.json by fetching releases from GitHub,
 * collating commits between consecutive releases via the Compare API,
 * and reformatting them into end-user-friendly patch notes.
 *
 * Usage:
 *   node scripts/build-patch-notes.mjs --output data/patch-notes.json
 *   node scripts/build-patch-notes.mjs --output data/patch-notes.json --force
 *   GH_TOKEN=... node scripts/build-patch-notes.mjs
 */

import fs from "node:fs";
import path from "node:path";
import { collateReleaseCommits } from "./format-patch-notes.mjs";

const DEFAULT_REPO = "Emperor-of-Modkind/emperor-mod-manager";
const DEFAULT_OUTPUT = path.resolve("data/patch-notes.json");

function parseArgs(argv) {
  let repo = DEFAULT_REPO;
  let output = DEFAULT_OUTPUT;
  let force = false;
  let includePrereleases = false;

  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--repo" && argv[i + 1]) {
      repo = argv[++i];
    } else if (argv[i] === "--output" && argv[i + 1]) {
      output = path.resolve(argv[++i]);
    } else if (argv[i] === "--force") {
      force = true;
    } else if (argv[i] === "--include-prereleases") {
      includePrereleases = true;
    }
  }

  return { repo, output, force, includePrereleases };
}

function getHeaders() {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN || "";
  const headers = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "emperor-mod-manager-site-builder",
  };
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: getHeaders() });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`GitHub API ${res.status} for ${url}: ${body.slice(0, 200)}`);
  }
  return res.json();
}

async function fetchAllReleases(repo, includePrereleases) {
  const all = [];
  let page = 1;
  while (true) {
    const batch = await fetchJson(
      `https://api.github.com/repos/${repo}/releases?per_page=100&page=${page}`,
    );
    if (!Array.isArray(batch) || batch.length === 0) break;
    all.push(...batch);
    if (batch.length < 100) break;
    page += 1;
  }

  const filtered = all.filter((r) => {
    if (!r || !r.tag_name || r.draft) return false;
    if (!includePrereleases && r.prerelease) return false;
    return true;
  });

  // Sort chronologically: oldest -> newest
  filtered.sort((a, b) => {
    const timeA = Date.parse(a.published_at || a.created_at || 0) || 0;
    const timeB = Date.parse(b.published_at || b.created_at || 0) || 0;
    if (timeA !== timeB) return timeA - timeB;
    return String(a.tag_name).localeCompare(String(b.tag_name), undefined, { numeric: true });
  });

  return filtered;
}

function loadExistingCache(outputPath) {
  const cache = new Map();
  try {
    if (!fs.existsSync(outputPath)) return cache;
    const raw = JSON.parse(fs.readFileSync(outputPath, "utf8"));
    for (const rel of raw?.releases || []) {
      if (rel?.tag) {
        cache.set(`${rel.tag}|${rel.previousTag || ""}`, rel);
      }
    }
  } catch {
    // Ignore unreadable or missing cache
  }
  return cache;
}

async function fetchCommitsForRelease(repo, prevTag, tag) {
  if (prevTag) {
    const compare = await fetchJson(
      `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(prevTag)}...${encodeURIComponent(tag)}`,
    );
    return Array.isArray(compare?.commits) ? compare.commits : [];
  }

  // Oldest release on the timeline: fetch commits up to its tag (capped to keep initial release concise)
  const commits = await fetchJson(
    `https://api.github.com/repos/${repo}/commits?sha=${encodeURIComponent(tag)}&per_page=10`,
  );
  return Array.isArray(commits) ? commits.reverse() : [];
}

async function main() {
  const { repo, output, force, includePrereleases } = parseArgs(process.argv.slice(2));
  const cache = force ? new Map() : loadExistingCache(output);

  console.log(`Fetching releases for ${repo}…`);
  const releases = await fetchAllReleases(repo, includePrereleases);
  console.log(`Found ${releases.length} ${includePrereleases ? "" : "stable "}releases.`);

  const built = [];
  let cachedCount = 0;
  let fetchedCount = 0;

  for (let i = 0; i < releases.length; i += 1) {
    const rel = releases[i];
    const prev = i > 0 ? releases[i - 1] : null;
    const prevTag = prev ? prev.tag_name : null;
    const cacheKey = `${rel.tag_name}|${prevTag || ""}`;

    if (cache.has(cacheKey)) {
      built.push(cache.get(cacheKey));
      cachedCount += 1;
      continue;
    }

    const commits = await fetchCommitsForRelease(repo, prevTag, rel.tag_name);
    const collated = collateReleaseCommits(commits, { releaseBody: rel.body || "" });

    const compareUrl = prevTag
      ? `https://github.com/${repo}/compare/${encodeURIComponent(prevTag)}...${encodeURIComponent(rel.tag_name)}`
      : null;

    built.push({
      tag: rel.tag_name,
      previousTag: prevTag,
      name: rel.name || rel.tag_name,
      headline: collated.headline,
      publishedAt: rel.published_at || rel.created_at || null,
      prerelease: Boolean(rel.prerelease),
      releaseUrl:
        rel.html_url || `https://github.com/${repo}/releases/tag/${encodeURIComponent(rel.tag_name)}`,
      compareUrl,
      commitCount: collated.commitCount,
      changeCount: collated.changeCount,
      sections: collated.sections,
    });
    fetchedCount += 1;
  }

  // Newest-first for timeline display
  built.reverse();

  const manifest = {
    repo,
    generatedAt: new Date().toISOString(),
    releaseCount: built.length,
    releases: built,
  };

  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(
    `Wrote ${built.length} releases to ${output} (${fetchedCount} fetched, ${cachedCount} cached).`,
  );
}

main().catch((err) => {
  console.error("Failed to build patch notes manifest:", err);
  process.exit(1);
});
