// Wiki page interactivity: active TOC highlighting on scroll and quick section filter.

function initWiki() {
  const tocLinks = Array.from(document.querySelectorAll(".wiki-toc a"));
  const sections = Array.from(document.querySelectorAll(".wiki-section[id]"));
  const searchInput = document.querySelector("[data-wiki-search]");
  const emptyNotice = document.querySelector("[data-wiki-empty]");

  if (sections.length > 0 && tocLinks.length > 0 && "IntersectionObserver" in window) {
    const linkById = new Map(tocLinks.map((a) => [a.getAttribute("href")?.slice(1), a]));

    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            const activeLink = linkById.get(entry.target.id);
            if (!activeLink) continue;
            tocLinks.forEach((a) => a.classList.toggle("is-active", a === activeLink));
          }
        }
      },
      { rootMargin: "-20% 0px -65% 0px", threshold: 0 }
    );

    sections.forEach((section) => observer.observe(section));
  }

  if (searchInput) {
    searchInput.addEventListener("input", () => {
      const query = searchInput.value.trim().toLowerCase();
      let visibleCount = 0;

      for (const section of sections) {
        const matches = !query || section.textContent.toLowerCase().includes(query);
        section.hidden = !matches;
        if (matches) visibleCount += 1;

        const link = tocLinks.find((a) => a.getAttribute("href") === `#${section.id}`);
        if (link) {
          link.parentElement.hidden = !matches;
        }
      }

      if (emptyNotice) {
        emptyNotice.hidden = visibleCount > 0;
      }
    });
  }
}

initWiki();
