/**
 * Collates raw Git commits between releases and reformats them into
 * clean, categorized, end-user-friendly patch notes.
 */

const NOISE_SUBJECT_PATTERNS = [
  /^merge\s+(branch|pull request|remote-tracking branch)\b/i,
  /^update\s+cargo\.lock$/i,
  /^update\s+package-lock\.json$/i,
  /^update\s+yarn\.lock$/i,
  /^update\s+pnpm-lock\.yaml$/i,
  /^bump\s+version\b/i,
  /^version\s+bump\b/i,
  /^chore(\([^)]*\))?:\s*(bump|release|lockfile|cargo\.lock)\b/i,
  /^release\s+v?\d+\.\d+\.\d+$/i,
  /^v?\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/,
];

const PLACEHOLDER_SUBJECT_PATTERNS = [
  /^see\s+desc(ription)?\.?$/i,
  /^see\s+below\.?$/i,
  /^changelog\.?$/i,
  /^patch\s+notes\.?$/i,
  /^release\s+notes\.?$/i,
];

const CODE_FILE_EXT_RE = /\.(rs|ts|tsx|js|jsx|mjs|cjs|css|scss|html|json|toml|lock|sh|yml|yaml|md)$/i;

/**
 * Returns true if a single token looks like an internal code symbol,
 * file path, CSS selector, or Rust attribute rather than normal English prose.
 */
function isCodeToken(token) {
  const t = token.trim().replace(/^`|`$/g, "");
  if (!t) return true;

  // Preserve user-facing protocols, packages, and paths
  if (/^(nxm|emperor|https?):\/\//i.test(t)) return false;
  if (/^(AppImage|PKGBUILD|FOMOD|NSFW|P2P|Steam|Proton|Wine|Linux|Windows|KDE|GTK|Nexus|Thunderstore|mod\.io|Epic|Heroic|Lutris|Bottles)$/i.test(t)) {
    return false;
  }

  // Rust attributes / macros like #[cfg(...)]
  if (/^#\[.*\]$/.test(t)) return true;
  // File paths or source filenames like p2p/mod.rs, StatusBanner.tsx, src-tauri/tauri.conf.json
  if (CODE_FILE_EXT_RE.test(t)) return true;
  if (/^[a-z0-9_.-]+\/[a-z0-9_.-]+(\/[a-z0-9_.-]+)*$/i.test(t) && !/^(Windows|Linux|Debian|Arch|Required|Recommended)/i.test(t)) {
    return true;
  }
  // CSS class selectors like .page-panel, .detail-collections-box
  if (/^\.[a-z][a-z0-9_-]*$/i.test(t)) return true;
  // Function calls like pop(), scan_games()
  if (/^[a-zA-Z_][a-zA-Z0-9_]*\(\)$/.test(t)) return true;
  // snake_case identifiers (must contain underscore)
  if (/^[a-z][a-z0-9]*(_[a-z0-9]+)+$/.test(t)) return true;
  // UPPER_SNAKE_CASE constants
  if (/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$/.test(t)) return true;
  // camelCase or PascalCase multi-hump identifiers (at least two capital transitions or lower->upper)
  if (/^[a-z]+[A-Z][a-zA-Z0-9]*$/.test(t)) return true;
  if (/^[A-Z][a-z]+[A-Z][a-zA-Z0-9]*$/.test(t)) return true;

  return false;
}

/**
 * Checks whether the contents of a parenthetical (...) consist purely of
 * internal code references (file names, component names, function names, CSS classes).
 */
function isCodeOnlyParenthetical(inner) {
  const trimmed = inner.trim();
  if (!trimmed) return true;

  // Strip a leading "via " or "in " or "backed by " if followed only by code tokens
  const stripped = trimmed.replace(/^(via|in|from|backed by|using|reusing)\s+/i, "");
  if (isCodeToken(stripped)) return true;

  const parts = stripped.split(/\s*(?:,|\s+\/\s+|&|\band\b)\s*/i).filter(Boolean);
  if (parts.length === 0) return false;

  return parts.every((part) => isCodeToken(part));
}

/**
 * Cleans raw commit text into friendly, readable end-user prose while
 * preserving meaningful technical/modding terms (FOMOD, AppImage, nxm://, Proton, etc.).
 */
export function cleanForEndUsers(text, { isHeading = false } = {}) {
  if (!text) return "";
  let s = String(text).replace(/\r\n?/g, "\n").replace(/\s+/g, " ").trim();

  // Remove parentheticals that only contain internal code/file references
  s = s.replace(/\s*\(([^()]+)\)/g, (match, inner) => {
    if (isCodeOnlyParenthetical(inner)) {
      return "";
    }
    // Keep parentheticals with human text, but clean trailing "via some_fn" or "in SomeFile.tsx"
    let cleanedInner = inner
      .replace(/\s+via\s+[a-z][a-z0-9_]*(_[a-z0-9]+)+/gi, "")
      .replace(/\s+in\s+[A-Za-z0-9_./-]+\.(tsx|ts|jsx|js|rs|css|json)\b/gi, "")
      .replace(/\s*\b[A-Z][A-Z0-9_]{3,}\s*,\s*/g, "")
      .trim();
    if (!cleanedInner || isCodeOnlyParenthetical(cleanedInner)) {
      return "";
    }
    return ` (${cleanedInner})`;
  });

  if (!isHeading) {
    // Soften/remove internal file paths in prose like "in src-tauri/tauri.conf.json" or "in BrowseResults.tsx"
    s = s.replace(/\s+in\s+(?:[a-z0-9_.-]+\/)*[A-Za-z0-9_.-]+\.(?:tsx|ts|jsx|js|rs|css|json)\b/gi, "");
    s = s.replace(/\s+out of\s+[A-Za-z0-9_.-]+\.(?:tsx|ts|jsx|js|rs)\s+into\s+[a-z0-9_./-]+\.(?:tsx|ts|jsx|js|rs)\b/gi, "");
    // Clean "via some_snake_case_cmd"
    s = s.replace(/\s+via\s+`?[a-z][a-z0-9]*(_[a-z0-9]+)+`?/g, "");
    // Clean "behind #[cfg(...)]"
    s = s.replace(/\s+behind\s+#\[[^\]]+\]/g, "");
  }

  // Strip stray leading/trailing punctuation artifacts and collapse spaces
  // (avoid collapsing space before CSS class names like " .page-chrome" or file extensions like " .deb")
  s = s
    .replace(/\s+([,;:!?])/g, "$1")
    .replace(/\s+\.(?=$|\s|[)\]"'])/g, ".")
    .replace(/\(\s+/g, "(")
    .replace(/\s+\)/g, ")")
    .replace(/\(\s*\)/g, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // Expand terse shorthand at the beginning of a sentence
  if (!isHeading) {
    s = s.replace(/^init\s+/i, "Initial ");
    s = s.replace(/^wip[:\s-]+/i, "");
  }

  // Capitalize first letter if it starts with a lowercase word (except known lowercase brand/protocols)
  if (s && /^[a-z]/.test(s) && !/^(id Tech|mod\.io|nxm:\/\/|emperor:\/\/|iOS|macOS|\.[a-z])/.test(s)) {
    s = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // Ensure descriptions end with punctuation
  if (!isHeading && s && !/[.!?]$/.test(s)) {
    s += ".";
  }

  return s;
}

/**
 * Extracts a version prefix (if any) and optional headline from a commit subject.
 * Example: "0.8.1 - performance improvements and cleanup" -> { isVersionSubject: true, headline: "Performance improvements and cleanup" }
 */
export function parseSubject(subject) {
  const trimmed = String(subject || "").trim();
  if (!trimmed) {
    return { isVersionSubject: false, isPlaceholder: true, headline: "", text: "" };
  }

  if (PLACEHOLDER_SUBJECT_PATTERNS.some((re) => re.test(trimmed))) {
    return { isVersionSubject: false, isPlaceholder: true, headline: "", text: "" };
  }

  const versionOnly = /^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(trimmed);
  if (versionOnly) {
    return { isVersionSubject: true, isPlaceholder: false, headline: "", text: "" };
  }

  const versionWithSubtitle = trimmed.match(/^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?\s*[-–—:]\s*(.+)$/);
  if (versionWithSubtitle) {
    const headline = cleanForEndUsers(versionWithSubtitle[1], { isHeading: true });
    return { isVersionSubject: true, isPlaceholder: false, headline, text: "" };
  }

  // Conventional commit prefix cleanup: "feat(ui): something" -> "something"
  const conventional = trimmed.match(/^(feat|fix|perf|refactor|style|docs|chore|build|ci|test)(?:\(([^)]+)\))?!?:\s*(.+)$/i);
  if (conventional) {
    return {
      isVersionSubject: false,
      isPlaceholder: false,
      headline: "",
      conventionalType: conventional[1].toLowerCase(),
      conventionalScope: conventional[2] || "",
      text: conventional[3].trim(),
    };
  }

  return { isVersionSubject: false, isPlaceholder: false, headline: "", text: trimmed };
}

/**
 * Returns true if a commit is purely maintenance/noise (merge commit, Cargo.lock update, etc.)
 * and has no meaningful body text.
 */
export function isNoiseCommit(message) {
  const lines = String(message || "")
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

  if (lines.length === 0) return true;
  if (lines.length > 1) {
    // Only consider merge commits with multi-line auto-generated PR bodies as noise if they're pure merge headers
    if (/^merge\s+(branch|remote-tracking branch)\b/i.test(lines[0])) {
      return true;
    }
    return false;
  }

  return NOISE_SUBJECT_PATTERNS.some((re) => re.test(lines[0]));
}

/**
 * Heuristic to detect whether a body line is a standalone section heading
 * (e.g. "FOMOD & Mod Staging", "Collections & Catalog Covers", "P2P Friends (p2p/mod.rs)", "Config").
 */
function isSectionHeadingLine(line, nextLine) {
  if (!line || !nextLine) return false;
  if (/^[-*•]\s+/.test(line)) return false;
  if (line.length > 68) return false;
  if (/[.!?:]$/.test(line)) return false;
  if (/:\s+/.test(line)) return false;
  if (/\s+[—–-]\s+/.test(line)) return false;
  if (/\.\s+[A-Z]/.test(line)) return false;
  if (CODE_FILE_EXT_RE.test(line)) return false;

  const words = line.split(/\s+/).filter(Boolean);
  if (words.length > 7) return false;

  // Must start with an uppercase letter or digit (e.g. "P2P Friends", "UI & Layout")
  if (!/^[A-Z0-9]/.test(line)) return false;

  // Avoid mistaking a short imperative commit sentence like "Fixed crash on startup" for a heading
  if (/^(Added|Fixed|Removed|Updated|Update|Replaced|Tuned|Improved|Changed|Moved|Extracted|Refactored|Delete|Deleted|Merge)\b/.test(line)) {
    return false;
  }

  return true;
}

/**
 * Parses a single content line into { title, description }.
 */
function parseItemLine(rawLine) {
  const line = rawLine.replace(/^[-*•]\s+/, "").trim();
  if (!line) return null;

  // Pattern 1: "Lead Title: Description..." (avoid matching URLs like https://)
  const colonMatch = line.match(/^([^:]{3,110}):\s+(.+)$/);
  if (colonMatch && !/https?$|nxm$|emperor$/i.test(colonMatch[1])) {
    const title = cleanForEndUsers(colonMatch[1], { isHeading: true });
    const description = cleanForEndUsers(colonMatch[2]);
    if (title && description) {
      return { title, description, subitems: [] };
    }
  }

  // Pattern 2: "Lead Title — Description..." (em-dash or en-dash separator)
  const dashMatch = line.match(/^([^—–]{3,70})\s+[—–]\s+(.+)$/);
  if (dashMatch) {
    const title = cleanForEndUsers(dashMatch[1], { isHeading: true });
    const description = cleanForEndUsers(dashMatch[2]);
    if (title && description) {
      return { title, description, subitems: [] };
    }
  }

  // Pattern 3: "Lead Title. Description..." (e.g. "id Tech. Support for DOOM...", "FOMOD. Configure/Deploy...")
  const periodMatch = line.match(/^([A-Za-z0-9][^.]{1,42})\.\s+([A-Z].+)$/);
  if (periodMatch) {
    const candidateTitle = periodMatch[1].trim();
    const wordCount = candidateTitle.split(/\s+/).length;
    if (wordCount <= 5) {
      const title = cleanForEndUsers(candidateTitle, { isHeading: true });
      const description = cleanForEndUsers(periodMatch[2]);
      if (title && description) {
        return { title, description, subitems: [] };
      }
    }
  }

  // Plain bullet item without a separate lead title
  const cleaned = cleanForEndUsers(line);
  if (!cleaned) return null;
  return { title: "", description: cleaned, subitems: [] };
}

/**
 * Classifies a section title or item text into a semantic kind for styling badges.
 */
export function classifyKind(text) {
  const lower = String(text || "").toLowerCase();
  if (/\b(fix\w*|bug\w*|crash\w*|leak\w*|broken|repair\w*|stall\w*|error\w*|issue\w*|prevent\w*|guard\w*)\b/.test(lower)) {
    return "fix";
  }
  if (/\b(add\w*|new|support\w*|initial|feature\w*|import\w*|sharing|avatar\w*|integrat\w*)\b/.test(lower)) {
    return "feature";
  }
  if (/\b(improv\w*|perf\w*|faster|smooth\w*|polish\w*|ui|ux|layout|virtual\w*|clean\w*|refactor\w*|optimiz\w*|updat\w*|config\w*|packag\w*)\b/.test(lower)) {
    return "improvement";
  }
  return "other";
}

function inferDefaultSectionTitle(text, conventionalType = "") {
  if (conventionalType === "fix") return "Bug Fixes";
  if (conventionalType === "feat") return "New Features";
  if (["perf", "refactor", "style"].includes(conventionalType)) return "Improvements";

  const kind = classifyKind(text);
  if (kind === "fix") return "Bug Fixes";
  if (kind === "feature") return "New Features";
  if (kind === "improvement") return "Improvements";
  return "Other Changes";
}

/**
 * Parses a single commit message into { headline, sections }.
 */
export function parseCommitMessage(message) {
  const rawLines = String(message || "").replace(/\r\n?/g, "\n").split("\n");
  const nonEmptyLines = rawLines.map((l) => l.trim()).filter(Boolean);

  if (nonEmptyLines.length === 0) {
    return { headline: "", sections: [] };
  }

  const subjectInfo = parseSubject(nonEmptyLines[0]);
  const bodyLines = nonEmptyLines.slice(1);
  const sections = [];

  function pushItem(sectionTitle, item) {
    if (!item) return;
    const cleanTitle = cleanForEndUsers(sectionTitle, { isHeading: true }) || "Changes";
    let sec = sections.find((s) => s.title.toLowerCase() === cleanTitle.toLowerCase());
    if (!sec) {
      sec = { title: cleanTitle, kind: classifyKind(cleanTitle), items: [] };
      sections.push(sec);
    }
    sec.items.push(item);
  }

  // Case A: Commit has a structured body
  if (bodyLines.length > 0) {
    const useSubjectAsSection =
      subjectInfo.text &&
      !CODE_FILE_EXT_RE.test(subjectInfo.text) &&
      subjectInfo.text.length <= 55;
    let currentSection = useSubjectAsSection
      ? cleanForEndUsers(subjectInfo.text, { isHeading: true })
      : "Highlights";

    for (let i = 0; i < bodyLines.length; i += 1) {
      const line = bodyLines[i];
      const nextLine = bodyLines[i + 1] || "";

      // Skip GitHub trailer lines like Co-authored-by / Signed-off-by
      if (/^(Co-authored-by|Signed-off-by|Reviewed-by):/i.test(line)) {
        continue;
      }

      if (isSectionHeadingLine(line, nextLine)) {
        currentSection = cleanForEndUsers(line, { isHeading: true });
        continue;
      }

      // Detect sub-list intro line ending with ":" (e.g. "Scroll & animation performance:")
      if (/^[^:]{3,90}:$/.test(line) && nextLine) {
        const groupTitle = cleanForEndUsers(line.slice(0, -1), { isHeading: true });
        const subitems = [];
        let j = i + 1;
        while (j < bodyLines.length) {
          const candidate = bodyLines[j];
          const afterCandidate = bodyLines[j + 1] || "";
          if (isSectionHeadingLine(candidate, afterCandidate)) break;
          if (/^[^:]{3,95}:\s+/.test(candidate) && !/^[-*•]\s+/.test(candidate)) break;
          if (/^[^:]{3,90}:$/.test(candidate)) break;
          const cleanedSub = cleanForEndUsers(candidate.replace(/^[-*•]\s+/, ""));
          if (cleanedSub) subitems.push(cleanedSub);
          j += 1;
        }
        if (subitems.length > 0) {
          pushItem(currentSection, { title: groupTitle, description: "", subitems });
          i = j - 1;
          continue;
        }
      }

      const item = parseItemLine(line);
      if (item) {
        pushItem(currentSection, item);
      }
    }

    return { headline: subjectInfo.headline, sections };
  }

  // Case B: Single-line commit message
  if (subjectInfo.text) {
    // Split compound commits joined by " + " (e.g. "improved webview + added log in prompt from settings")
    const clauses = subjectInfo.text.split(/\s+\+\s+/).map((c) => c.trim()).filter(Boolean);
    for (const clause of clauses) {
      const item = parseItemLine(clause);
      if (!item) continue;
      const secTitle = inferDefaultSectionTitle(
        item.title || item.description,
        subjectInfo.conventionalType,
      );
      pushItem(secTitle, item);
    }
  }

  return { headline: subjectInfo.headline, sections };
}

/**
 * Collates an array of raw commit objects (in chronological or reverse order)
 * for a single release into a unified, deduplicated, end-user-friendly structure.
 *
 * Each commit can be either a GitHub API commit object (`{ sha, commit: { message } }`)
 * or a plain `{ sha, message }` object.
 */
export function collateReleaseCommits(commits, { releaseBody = "" } = {}) {
  const messages = (commits || [])
    .map((c) => (typeof c === "string" ? c : c?.commit?.message ?? c?.message ?? ""))
    .filter(Boolean);

  // Filter out pure maintenance/noise commits unless all commits are noise
  const meaningful = messages.filter((msg) => !isNoiseCommit(msg));
  const selected = meaningful.length > 0 ? meaningful : messages;

  let headline = "";
  const mergedSections = new Map();
  const seenItemKeys = new Set();

  for (const msg of selected) {
    const parsed = parseCommitMessage(msg);
    if (!headline && parsed.headline) {
      headline = parsed.headline;
    }

    for (const sec of parsed.sections) {
      const key = sec.title.toLowerCase();
      if (!mergedSections.has(key)) {
        mergedSections.set(key, {
          title: sec.title,
          kind: sec.kind,
          items: [],
        });
      }
      const target = mergedSections.get(key);

      for (const item of sec.items) {
        const dedupeKey = `${item.title.toLowerCase()}|${item.description.toLowerCase()}`;
        if (seenItemKeys.has(dedupeKey)) continue;
        seenItemKeys.add(dedupeKey);
        target.items.push(item);
      }
    }
  }

  // Order generic inferred sections nicely if they appear together
  const genericOrder = new Map([
    ["highlights", 1],
    ["new features", 2],
    ["improvements", 3],
    ["bug fixes", 4],
    ["other changes", 5],
  ]);

  const sections = Array.from(mergedSections.values()).filter((s) => s.items.length > 0);
  const allGeneric = sections.every((s) => genericOrder.has(s.title.toLowerCase()));
  if (allGeneric) {
    sections.sort(
      (a, b) =>
        (genericOrder.get(a.title.toLowerCase()) ?? 99) -
        (genericOrder.get(b.title.toLowerCase()) ?? 99),
    );
  }

  // Fallback if no commits yielded any sections: check releaseBody for non-changelog prose
  if (sections.length === 0 && releaseBody) {
    const cleanedBody = releaseBody
      .replace(/\*\*Full Changelog\*\*:.*$/gim, "")
      .trim();
    if (cleanedBody) {
      const parsedBody = parseCommitMessage(cleanedBody);
      sections.push(...parsedBody.sections);
    }
  }

  const changeCount = sections.reduce((sum, s) => sum + s.items.length, 0);

  return {
    headline,
    commitCount: messages.length,
    changeCount,
    sections,
  };
}
