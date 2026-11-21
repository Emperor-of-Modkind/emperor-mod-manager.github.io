// Patch Notes Timeline page: renders collated release patch notes from data/patch-notes.json
// with search filtering, version jump rail, deep-link hash support, and accessible disclosures.

const REPO = "Emperor-of-Modkind/emperor-mod-manager";
const MANIFEST_URL = "./data/patch-notes.json";
const RELEASES_URL = `https://github.com/${REPO}/releases`;
const EXPANDED_BY_DEFAULT_COUNT = 5;

const INLINE_CODE_RE =
  /((?:nxm|emperor):\/\/[^\s,.)]+|~\/[A-Za-z0-9_./-]+|%[A-Z_]+%\\[A-Za-z0-9_.\\-]+|\bPKGBUILD\b|\bAppImage\b|\b\.deb\b|\bSHA256SUMS\b)/g;

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

/**
 * Appends text to a parent element while safely wrapping recognized user-facing
 * protocol/path/package tokens in <code> elements (no innerHTML).
 */
function appendRichText(parent, text) {
  if (!text) return;
  let lastIndex = 0;
  INLINE_CODE_RE.lastIndex = 0;
  let match;
  while ((match = INLINE_CODE_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parent.appendChild(document.createTextNode(text.slice(lastIndex, match.index)));
    }
    const code = document.createElement("code");
    code.textContent = match[0];
    parent.appendChild(code);
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    parent.appendChild(document.createTextNode(text.slice(lastIndex)));
  }
}

function buildSearchableText(release) {
  const parts = [release.tag, release.name, release.headline];
  for (const sec of release.sections || []) {
    parts.push(sec.title);
    for (const item of sec.items || []) {
      parts.push(item.title, item.description, ...(item.subitems || []));
    }
  }
  return parts.filter(Boolean).join(" ").toLowerCase();
}

function createReleaseSections(release) {
  const sectionsWrap = document.createElement("div");
  sectionsWrap.className = "timeline-sections";

  if (!release.sections || release.sections.length === 0) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Maintenance and packaging updates.";
    sectionsWrap.appendChild(empty);
    return sectionsWrap;
  }

  for (const section of release.sections) {
    const group = document.createElement("section");
    group.className = "change-group";

    const heading = document.createElement("h3");
    heading.className = `change-group-title is-${section.kind || "other"}`;

    const dot = document.createElement("span");
    dot.className = "change-group-dot";
    dot.setAttribute("aria-hidden", "true");
    heading.append(dot, document.createTextNode(section.title));
    group.appendChild(heading);

    const list = document.createElement("ul");
    list.className = "change-list";

    for (const item of section.items || []) {
      const li = document.createElement("li");
      li.className = "change-item";

      const line = document.createElement("div");
      line.className = "change-item-text";

      if (item.title) {
        const strong = document.createElement("strong");
        strong.textContent = item.title;
        line.appendChild(strong);
        if (item.description) {
          line.appendChild(document.createTextNode(": "));
        }
      }

      if (item.description) {
        appendRichText(line, item.description);
      }

      li.appendChild(line);

      if (item.subitems && item.subitems.length > 0) {
        const sub = document.createElement("ul");
        sub.className = "change-sublist";
        for (const subText of item.subitems) {
          const subLi = document.createElement("li");
          appendRichText(subLi, subText);
          sub.appendChild(subLi);
        }
        li.appendChild(sub);
      }

      list.appendChild(li);
    }

    group.appendChild(list);
    sectionsWrap.appendChild(group);
  }

  return sectionsWrap;
}

function createReleaseFooter(release, isLatest) {
  const footer = document.createElement("div");
  footer.className = "timeline-card-footer";

  if (isLatest) {
    const dlLink = document.createElement("a");
    dlLink.className = "timeline-action-link is-primary";
    dlLink.href = "./downloads.html";
    dlLink.textContent = `Download ${release.tag}`;
    footer.appendChild(dlLink);
  } else if (release.releaseUrl) {
    const ghRelease = document.createElement("a");
    ghRelease.className = "timeline-action-link";
    ghRelease.href = release.releaseUrl;
    ghRelease.target = "_blank";
    ghRelease.rel = "noopener noreferrer";
    ghRelease.textContent = "GitHub Release";
    footer.appendChild(ghRelease);
  }

  if (release.compareUrl && release.previousTag) {
    const diffLink = document.createElement("a");
    diffLink.className = "timeline-action-link";
    diffLink.href = release.compareUrl;
    diffLink.target = "_blank";
    diffLink.rel = "noopener noreferrer";
    diffLink.textContent = `Compare ${release.previousTag} → ${release.tag}`;
    footer.appendChild(diffLink);
  }

  return footer;
}

function createTimelineItem(release, index) {
  const isLatest = index === 0;
  const isCollapsible = index >= EXPANDED_BY_DEFAULT_COUNT;
  const isDeferred = index >= EXPANDED_BY_DEFAULT_COUNT;

  const li = document.createElement("li");
  li.className = "timeline-item";
  if (isLatest) li.classList.add("is-latest");
  if (isDeferred) li.classList.add("is-deferred");
  li.dataset.releaseTag = release.tag;
  li.dataset.searchText = buildSearchableText(release);

  const marker = document.createElement("span");
  marker.className = "timeline-node";
  marker.setAttribute("aria-hidden", "true");
  li.appendChild(marker);

  const formattedDate = formatDate(release.publishedAt);
  const changeLabel =
    release.changeCount === 1 ? "1 change" : `${release.changeCount || 0} changes`;

  if (!isCollapsible) {
    const card = document.createElement("article");
    card.className = isLatest ? "timeline-card is-latest" : "timeline-card";
    card.id = release.tag;

    const header = document.createElement("header");
    header.className = "timeline-card-header";

    const titleRow = document.createElement("div");
    titleRow.className = "timeline-title-row";

    const h2 = document.createElement("h2");
    h2.className = "timeline-version";
    h2.textContent = release.tag;
    titleRow.appendChild(h2);

    if (isLatest) {
      const badge = document.createElement("span");
      badge.className = "pill pill-accent";
      badge.textContent = "Latest";
      titleRow.appendChild(badge);
    }

    if (release.previousTag) {
      const rangePill = document.createElement("span");
      rangePill.className = "pill";
      rangePill.textContent = `since ${release.previousTag}`;
      titleRow.appendChild(rangePill);
    }

    const metaRow = document.createElement("div");
    metaRow.className = "timeline-meta";

    if (formattedDate) {
      const time = document.createElement("time");
      time.dateTime = release.publishedAt;
      time.textContent = formattedDate;
      metaRow.appendChild(time);
    }

    const countSpan = document.createElement("span");
    countSpan.className = "pill";
    countSpan.textContent = changeLabel;
    metaRow.appendChild(countSpan);

    header.append(titleRow, metaRow);

    if (release.headline) {
      const headline = document.createElement("p");
      headline.className = "timeline-headline";
      headline.textContent = release.headline;
      header.appendChild(headline);
    }

    card.append(header, createReleaseSections(release), createReleaseFooter(release, isLatest));
    li.appendChild(card);
    return li;
  }

  // Older releases use native <details> (no headings inside <summary> for screen-reader compatibility)
  const details = document.createElement("details");
  details.className = "timeline-details";
  details.id = release.tag;

  const summary = document.createElement("summary");
  summary.className = "timeline-summary";

  const summaryMain = document.createElement("span");
  summaryMain.className = "timeline-summary-main";

  const versionSpan = document.createElement("span");
  versionSpan.className = "timeline-summary-version";
  versionSpan.textContent = release.tag;
  summaryMain.appendChild(versionSpan);

  if (release.headline) {
    const headlineSpan = document.createElement("span");
    headlineSpan.className = "timeline-summary-headline";
    headlineSpan.textContent = release.headline;
    summaryMain.appendChild(headlineSpan);
  }

  const summaryMeta = document.createElement("span");
  summaryMeta.className = "timeline-summary-meta";

  if (formattedDate) {
    const time = document.createElement("time");
    time.dateTime = release.publishedAt;
    time.textContent = formattedDate;
    summaryMeta.appendChild(time);
  }

  const countPill = document.createElement("span");
  countPill.className = "pill";
  countPill.textContent = changeLabel;
  summaryMeta.appendChild(countPill);

  summary.append(summaryMain, summaryMeta);

  const body = document.createElement("div");
  body.className = "timeline-details-body";
  body.append(createReleaseSections(release), createReleaseFooter(release, false));

  details.append(summary, body);
  li.appendChild(details);
  return li;
}

function createTocItem(release, index) {
  const li = document.createElement("li");
  li.dataset.tocTag = release.tag;

  const a = document.createElement("a");
  a.href = `#${release.tag}`;
  if (index === 0) a.classList.add("is-active");

  const tagSpan = document.createElement("span");
  tagSpan.className = "version-toc-tag";
  tagSpan.textContent = release.tag;

  const dateSpan = document.createElement("span");
  dateSpan.className = "version-toc-date";
  dateSpan.textContent = formatDate(release.publishedAt);

  a.append(tagSpan, dateSpan);
  li.appendChild(a);
  return li;
}

function setupExpandCollapseAll(timelineEl, toggleBtn) {
  const getDetails = () => Array.from(timelineEl.querySelectorAll("details.timeline-details"));
  const initialDetails = getDetails();
  if (initialDetails.length === 0) {
    toggleBtn.hidden = true;
    return;
  }

  toggleBtn.hidden = false;

  function syncButtonState() {
    const items = getDetails().filter((d) => !d.closest(".timeline-item")?.hidden);
    const allOpen = items.length > 0 && items.every((d) => d.open);
    toggleBtn.setAttribute("aria-expanded", String(allOpen));
  }

  toggleBtn.addEventListener("click", () => {
    const expand = toggleBtn.getAttribute("aria-expanded") !== "true";
    for (const details of getDetails()) {
      if (!details.closest(".timeline-item")?.hidden) {
        details.open = expand;
      }
    }
    syncButtonState();
  });

  // toggle does not bubble, so listen in capture phase
  timelineEl.addEventListener(
    "toggle",
    (event) => {
      if (event.target instanceof HTMLDetailsElement) {
        syncButtonState();
      }
    },
    { capture: true },
  );

  syncButtonState();
  return syncButtonState;
}

function openReleaseForHash(hash) {
  const id = String(hash || "").replace(/^#/, "").trim();
  if (!id) return;
  const target = document.getElementById(id);
  if (!target) return;
  if (target instanceof HTMLDetailsElement && !target.open) {
    target.open = true;
  }
  target.scrollIntoView({ behavior: "smooth", block: "start" });
}

function setupScrollSpy(tocEl) {
  const links = Array.from(tocEl.querySelectorAll("a[href^='#']"));
  if (links.length === 0) return;

  const targets = links
    .map((link) => document.getElementById(link.getAttribute("href").slice(1)))
    .filter(Boolean);

  if (targets.length === 0) return;

  const observer = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((e) => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length === 0) return;
      const activeId = visible[0].target.id;
      for (const link of links) {
        link.classList.toggle("is-active", link.getAttribute("href") === `#${activeId}`);
      }
    },
    { rootMargin: "-90px 0px -65% 0px", threshold: 0.01 },
  );

  for (const el of targets) {
    observer.observe(el);
  }
}

async function initPatchNotes() {
  const timelineEl = document.querySelector("[data-timeline]");
  const tocEl = document.querySelector("[data-version-toc]");
  const statusEl = document.querySelector("[data-changelog-status]");
  const searchInput = document.querySelector("[data-changelog-search]");
  const toggleBtn = document.querySelector("[data-toggle-all]");

  if (!timelineEl || !tocEl) return;

  try {
    const res = await fetch(MANIFEST_URL, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} loading ${MANIFEST_URL}`);
    }
    const data = await res.json();
    const releases = Array.isArray(data?.releases) ? data.releases : [];

    if (releases.length === 0) {
      throw new Error("No releases found in patch notes manifest");
    }

    timelineEl.replaceChildren();
    tocEl.replaceChildren();

    const timelineItems = [];
    const tocItems = [];

    releases.forEach((release, index) => {
      const item = createTimelineItem(release, index);
      const tocItem = createTocItem(release, index);
      timelineEl.appendChild(item);
      tocEl.appendChild(tocItem);
      timelineItems.push(item);
      tocItems.push(tocItem);
    });

    const latestTag = releases[0].tag;
    const oldestTag = releases[releases.length - 1].tag;
    const defaultStatus = `Showing ${releases.length} releases (${latestTag} down to ${oldestTag})`;
    if (statusEl) {
      statusEl.textContent = defaultStatus;
    }

    const syncToggleBtn = toggleBtn ? setupExpandCollapseAll(timelineEl, toggleBtn) : null;
    setupScrollSpy(tocEl);

    // Ensure clicking a TOC link opens a collapsed <details> release
    tocEl.addEventListener("click", (event) => {
      const link = event.target.closest?.("a[href^='#']");
      if (!link) return;
      const id = link.getAttribute("href").slice(1);
      const target = document.getElementById(id);
      if (target instanceof HTMLDetailsElement && !target.open) {
        target.open = true;
      }
    });

    // Live search filtering
    let emptyNote = null;
    if (searchInput) {
      searchInput.addEventListener("input", () => {
        const query = searchInput.value.trim().toLowerCase();
        let visibleCount = 0;

        timelineItems.forEach((item, idx) => {
          const matches = !query || (item.dataset.searchText || "").includes(query);
          item.hidden = !matches;
          if (tocItems[idx]) tocItems[idx].hidden = !matches;

          const details = item.querySelector("details.timeline-details");
          if (details && query && matches) {
            details.open = true;
          }

          if (matches) visibleCount += 1;
        });

        if (statusEl) {
          statusEl.textContent = query
            ? `Showing ${visibleCount} of ${releases.length} releases matching "${searchInput.value.trim()}"`
            : defaultStatus;
        }

        if (visibleCount === 0) {
          if (!emptyNote) {
            emptyNote = document.createElement("li");
            emptyNote.className = "status-note";
            emptyNote.textContent = "No releases or changes match your filter.";
            timelineEl.appendChild(emptyNote);
          }
          emptyNote.hidden = false;
        } else if (emptyNote) {
          emptyNote.hidden = true;
        }

        if (syncToggleBtn) syncToggleBtn();
      });
    }

    if (window.location.hash) {
      openReleaseForHash(window.location.hash);
    }
    window.addEventListener("hashchange", () => openReleaseForHash(window.location.hash));
  } catch (err) {
    console.error("Failed to load patch notes:", err);
    if (statusEl) statusEl.textContent = "Couldn't load patch notes automatically.";

    timelineEl.replaceChildren();
    const li = document.createElement("li");
    li.className = "status-note is-error";
    li.textContent = "Couldn't load the release timeline right now. ";
    const a = document.createElement("a");
    a.href = RELEASES_URL;
    a.target = "_blank";
    a.rel = "noopener noreferrer";
    a.textContent = "View releases directly on GitHub";
    li.appendChild(a);
    timelineEl.appendChild(li);
  }
}

initPatchNotes();
