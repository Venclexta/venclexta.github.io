(() => {
  const root = document.documentElement;
  const toggle = document.querySelector(".theme-toggle");

  function getStoredTheme() {
    try {
      return localStorage.getItem("theme");
    } catch {
      return null;
    }
  }

  function storeTheme(theme) {
    try {
      localStorage.setItem("theme", theme);
    } catch {
      // Ignore storage failures in private or restricted browsing modes.
    }
  }

  function setTheme(theme) {
    root.dataset.theme = theme;

    if (toggle) {
      toggle.setAttribute("aria-pressed", theme === "dark");
      toggle.setAttribute("aria-label", theme === "dark" ? "Switch to light mode" : "Switch to dark mode");
    }

    storeTheme(theme);
  }

  const initialTheme = root.dataset.theme || getStoredTheme() || "light";
  setTheme(initialTheme);

  if (toggle) {
    toggle.addEventListener("click", () => {
      setTheme(root.dataset.theme === "dark" ? "light" : "dark");
    });
  }

  const sectionNav = document.querySelector(".section-nav");
  if (!sectionNav) {
    return;
  }

  const navItems = [...sectionNav.querySelectorAll('a[href^="#"]')]
    .map((link) => ({ link, section: document.getElementById(link.hash.slice(1)) }))
    .filter(({ section }) => section);

  let clickLocked = false;
  let clickLockTimer = 0;
  let scrollFrame = 0;

  function keepActiveLinkVisible(link) {
    const navRect = sectionNav.getBoundingClientRect();
    const linkRect = link.getBoundingClientRect();
    let left = 0;

    if (linkRect.left < navRect.left) {
      left = linkRect.left - navRect.left - 8;
    } else if (linkRect.right > navRect.right) {
      left = linkRect.right - navRect.right + 8;
    }

    if (!left) {
      return;
    }

    if (typeof sectionNav.scrollBy === "function") {
      sectionNav.scrollBy({ left, behavior: "smooth" });
    } else {
      sectionNav.scrollLeft += left;
    }
  }

  function setActiveLink(activeLink) {
    for (const { link } of navItems) {
      const isActive = link === activeLink;
      link.toggleAttribute("aria-current", isActive);

      if (isActive) {
        link.setAttribute("aria-current", "location");
        keepActiveLinkVisible(link);
      }
    }
  }

  function lockClickedLink(link) {
    clickLocked = true;
    setActiveLink(link);
    window.clearTimeout(clickLockTimer);
    clickLockTimer = window.setTimeout(() => {
      clickLocked = false;
    }, 600);
  }

  function releaseClickLock() {
    clickLocked = false;
    window.clearTimeout(clickLockTimer);
  }

  function getCurrentNavItem() {
    let currentItem = null;
    let currentVisibleArea = -1;
    let currentDistance = Infinity;

    for (const item of navItems) {
      const rect = item.section.getBoundingClientRect();
      const visibleArea = Math.max(0, Math.min(rect.bottom, window.innerHeight) - Math.max(rect.top, 0));
      const distance = Math.abs(rect.top + rect.height / 2 - window.innerHeight * 0.45);

      if (visibleArea > currentVisibleArea || (visibleArea === currentVisibleArea && distance < currentDistance)) {
        currentItem = item;
        currentVisibleArea = visibleArea;
        currentDistance = distance;
      }
    }

    return currentItem;
  }

  function updateActiveSection() {
    const currentItem = getCurrentNavItem();

    if (currentItem) {
      setActiveLink(currentItem.link);
    }
  }

  for (const { link } of navItems) {
    link.addEventListener("click", () => lockClickedLink(link));
  }

  window.addEventListener("scroll", () => {
    if (clickLocked) {
      window.clearTimeout(clickLockTimer);
      clickLockTimer = window.setTimeout(() => {
        clickLocked = false;
      }, 250);
      return;
    }

    if (!scrollFrame) {
      scrollFrame = window.requestAnimationFrame(() => {
        scrollFrame = 0;
        updateActiveSection();
      });
    }
  }, { passive: true });

  window.addEventListener("wheel", releaseClickLock, { passive: true });
  window.addEventListener("touchstart", releaseClickLock, { passive: true });
  window.addEventListener("keydown", releaseClickLock);
})();
