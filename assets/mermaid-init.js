(() => {
  const GLOBAL_CONFIG_KEY = "__honkitPluginMermaidNext";
  const SELECTOR = ".mermaid";
  const DARK_QUERY = "(prefers-color-scheme: dark)";

  const defaultConfig = {
    theme: "auto",
    cdn: true,
    mermaidVersion: "11",
    mermaidCdn: "",
    lazy: false,
    lazyMargin: "200px",
    securityLevel: "loose",
    errorRenderer: true,
    config: {}
  };

  const pluginOptions = Object.assign(
    {},
    defaultConfig,
    window[GLOBAL_CONFIG_KEY] || {}
  );

  const sourceByNode = new WeakMap();
  const lazyObserver = new WeakSet();
  let mermaid = null;
  let activeTheme = null;
  let renderPromise = null;
  let renderTimer = null;
  let renderId = 0;
  let intersectionObserver = null;

  boot();

  async function boot() {
    try {
      mermaid = await loadMermaid();
      initializeMermaid();
      setupDarkModeListener();
      setupSpaObserver();

      if (pluginOptions.lazy) {
        setupLazyObserver();
      }

      await render();
    } catch (error) {
      showGlobalError(error);
    }
  }

  async function loadMermaid() {
    const url = getMermaidUrl();
    const module = await import(url);

    return module.default || module;
  }

  function getMermaidUrl() {
    if (pluginOptions.mermaidCdn) {
      return pluginOptions.mermaidCdn;
    }

    if (pluginOptions.cdn === false) {
      throw new Error(
        "honkit-plugin-mermaid-next: set pluginsConfig['mermaid-next'].mermaidCdn when cdn is false."
      );
    }

    const version = pluginOptions.mermaidVersion || "11";

    return "https://cdn.jsdelivr.net/npm/mermaid@" + version + "/dist/mermaid.esm.min.mjs";
  }

  function initializeMermaid() {
    const theme = resolveTheme();
    activeTheme = theme;

    mermaid.initialize(
      Object.assign(
        {},
        defaultConfig.config,
        {
          startOnLoad: false,
          securityLevel: pluginOptions.securityLevel,
          theme
        },
        pluginOptions.config || {}
      )
    );
  }

  function resolveTheme() {
    if (pluginOptions.theme === "auto") {
      return window.matchMedia && window.matchMedia(DARK_QUERY).matches
        ? "dark"
        : "default";
    }

    return pluginOptions.theme || "default";
  }

  function setupDarkModeListener() {
    if (!window.matchMedia || !window.matchMedia(DARK_QUERY)) {
      return;
    }

    const media = window.matchMedia(DARK_QUERY);
    const onChange = () => {
      if (pluginOptions.theme !== "auto") {
        return;
      }

      resetRenderedNodes();
      initializeMermaid();
      scheduleRender();
    };

    if (typeof media.addEventListener === "function") {
      media.addEventListener("change", onChange);
    } else if (typeof media.addListener === "function") {
      media.addListener(onChange);
    }
  }

  function getContentContainer() {
    return (
      document.querySelector(".book-body") ||
      document.querySelector(".book-content") ||
      document.querySelector(".page-inner") ||
      document.querySelector("main") ||
      document.documentElement
    );
  }

  function setupSpaObserver() {
    const observer = new MutationObserver(() => scheduleRender());

    observer.observe(getContentContainer(), {
      childList: true,
      subtree: true
    });

    window.addEventListener("load", () => scheduleRender());
    window.addEventListener("pageshow", () => scheduleRender());
    window.addEventListener("popstate", () => scheduleRender());
    window.addEventListener("honkit:page:rendered", () => scheduleRender());
    window.addEventListener("gitbook:page:rendered", () => scheduleRender());

    patchHistory("pushState");
    patchHistory("replaceState");
  }

  function patchHistory(methodName) {
    const original = window.history[methodName];

    if (!original) {
      return;
    }

    window.history[methodName] = function patchedHistoryMethod() {
      const result = original.apply(this, arguments);

      scheduleRender();

      return result;
    };
  }

  function setupLazyObserver() {
    if (!("IntersectionObserver" in window)) {
      return;
    }

    intersectionObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }

          entry.target.dataset.mermaidNextVisible = "true";
          intersectionObserver.unobserve(entry.target);
          lazyObserver.delete(entry.target);
          scheduleRender();
        }
      },
      {
        rootMargin: pluginOptions.lazyMargin || "200px"
      }
    );
  }

  async function render() {
    if (renderPromise) {
      return renderPromise;
    }

    renderPromise = (async () => {
      if (!mermaid) {
        return;
      }

      const theme = resolveTheme();

      if (theme !== activeTheme) {
        resetRenderedNodes();
        initializeMermaid();
      }

      const nodes = getRenderableNodes();

      for (const node of nodes) {
        await renderNode(node);
      }
    })().finally(() => {
      renderPromise = null;
    });

    return renderPromise;
  }

  function getRenderableNodes() {
    return Array.from(document.querySelectorAll(SELECTOR)).filter((node) => {
      if (node.dataset.mermaidNextRendered === "true") {
        return false;
      }

      if (!pluginOptions.lazy) {
        return true;
      }

      if (node.dataset.mermaidNextVisible === "true") {
        return true;
      }

      if (!("IntersectionObserver" in window)) {
        node.dataset.mermaidNextVisible = "true";
        return true;
      }

      if (isNodeInViewport(node)) {
        node.dataset.mermaidNextVisible = "true";
        return true;
      }

      observeNode(node);

      return false;
    });
  }

  function observeNode(node) {
    if (!intersectionObserver || lazyObserver.has(node)) {
      return;
    }

    lazyObserver.add(node);
    intersectionObserver.observe(node);
  }

  function isNodeInViewport(node) {
    const rect = node.getBoundingClientRect();
    const margin = parseRootMargin(pluginOptions.lazyMargin || "200px");

    return (
      rect.bottom >= -margin.bottom &&
      rect.top <= window.innerHeight + margin.top
    );
  }

  function parseRootMargin(value) {
    const parts = String(value || "0px")
      .split(/\s+/)
      .map((part) => parseInt(part, 10) || 0);

    if (parts.length === 1) {
      return {
        top: parts[0],
        bottom: parts[0]
      };
    }

    if (parts.length === 2) {
      return {
        top: parts[0],
        bottom: parts[1]
      };
    }

    if (parts.length === 3) {
      return {
        top: parts[0],
        bottom: parts[2]
      };
    }

    return {
      top: parts[0],
      bottom: parts[2]
    };
  }

  async function renderNode(node) {
    const source = sourceByNode.get(node) || node.textContent.trim();

    if (!source) {
      return;
    }

    sourceByNode.set(node, source);

    try {
      const id = "mermaid-next-" + renderId++;
      const result = await mermaid.render(id, source);

      node.innerHTML = result.svg;
      node.dataset.mermaidNextRendered = "true";
      node.dataset.mermaidNextTheme = activeTheme;
      node.removeAttribute("data-mermaid-next-error");

      if (typeof result.bindFunctions === "function") {
        result.bindFunctions(node);
      }
    } catch (error) {
      node.dataset.mermaidNextRendered = "true";
      node.dataset.mermaidNextError = "true";
      renderError(node, error);
    }
  }

  function renderError(node, error) {
    if (pluginOptions.errorRenderer === false) {
      return;
    }

    node.innerHTML = [
      '<pre class="mermaid-error" role="alert">',
      escapeHtml("Mermaid diagram render failed: " + (error && error.message ? error.message : error)),
      "</pre>"
    ].join("");
  }

  function resetRenderedNodes() {
    for (const node of document.querySelectorAll(SELECTOR)) {
      const source = sourceByNode.get(node) || node.textContent;

      node.textContent = source;
      node.dataset.mermaidNextRendered = "";
      node.dataset.mermaidNextTheme = "";
      node.dataset.mermaidNextError = "";
      node.removeAttribute("data-mermaid-next-rendered");
      node.removeAttribute("data-mermaid-next-theme");
      node.removeAttribute("data-mermaid-next-error");
    }
  }

  function scheduleRender() {
    if (renderTimer) {
      window.clearTimeout(renderTimer);
    }

    renderTimer = window.setTimeout(() => {
      renderTimer = null;
      render().catch(showGlobalError);
    }, 50);
  }

  function showGlobalError(error) {
    if (!pluginOptions.errorRenderer || !document.body) {
      return;
    }

    const node = document.createElement("pre");

    node.className = "mermaid-error";
    node.setAttribute("role", "alert");
    node.textContent = "honkit-plugin-mermaid-next: " + (error && error.message ? error.message : error);

    document.body.prepend(node);
  }

  function escapeHtml(value) {
    return String(value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
})();
