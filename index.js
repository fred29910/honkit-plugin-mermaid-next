"use strict";

const PLUGIN_CONFIG_KEY = "pluginsConfig";
const PLUGIN_NAME = "mermaid-next";

const DEFAULT_OPTIONS = {
  theme: "auto",
  cdn: true,
  mermaidVersion: "11",
  mermaidCdn: "",
  lazy: false,
  lazyMargin: "200px",
  securityLevel: "loose",
  escapeHtml: true,
  errorRenderer: true,
  config: {}
};

const state = {
  options: null
};

module.exports = {
  hooks: {
    init: function () {
      state.options = getPluginOptions(this.book);
      return state.options;
    },

    "page:before": function (page) {
      page.content = convertMermaidFences(page.content, getRuntimeOptions(this));
      return page;
    },

    page: function (page) {
      page.content = injectConfigScript(page.content, getRuntimeOptions(this));
      return page;
    },

    "ebook:before": function () {
      return { lazy: false };
    },

    "pdf:before": function () {
      return { lazy: false };
    }
  },

  website: {
    assets: "./assets",
    js: ["mermaid-init.js"],
    css: ["mermaid.css"]
  }
};

function getRuntimeOptions(context) {
  return (context && context.mermaidNextOptions) || state.options || DEFAULT_OPTIONS;
}

function getPluginOptions(book) {
  const pluginsConfig = getPluginsConfig(book);
  const pluginConfig = pluginsConfig[PLUGIN_NAME] || {};

  return mergeOptions(DEFAULT_OPTIONS, pluginConfig);
}

function getPluginsConfig(book) {
  try {
    const config = book && book.config;

    if (config && typeof config.get === "function") {
      return config.get(PLUGIN_CONFIG_KEY) || {};
    }

    return (config && config[PLUGIN_CONFIG_KEY]) || {};
  } catch (error) {
    return {};
  }
}

function mergeOptions(defaults, override) {
  const result = Object.assign({}, defaults);

  for (const key of Object.keys(override || {})) {
    if (
      isPlainObject(result[key]) &&
      isPlainObject(override[key])
    ) {
      result[key] = mergeOptions(result[key], override[key]);
    } else {
      result[key] = override[key];
    }
  }

  return result;
}

function convertMermaidFences(markdown, options) {
  if (typeof markdown !== "string") {
    return markdown;
  }

  const lines = markdown.split(/\r?\n/);
  const output = [];
  let index = 0;

  while (index < lines.length) {
    const fence = parseOpeningFence(lines[index]);

    if (!fence || !fence.info.startsWith("mermaid")) {
      output.push(lines[index]);
      index += 1;
      continue;
    }

    const body = [];
    index += 1;

    while (index < lines.length && !isClosingFence(lines[index], fence)) {
      body.push(lines[index]);
      index += 1;
    }

    if (index >= lines.length) {
      output.push(lines[index - body.length - 1]);
      output.push(...body);
      continue;
    }

    const code = normalizeDiagramSource(body.join("\n"));
    output.push(renderMermaidBlock(code, options));
    index += 1;
  }

  return output.join("\n");
}

function parseOpeningFence(line) {
  const match = line.match(/^([ \t]{0,3})(`{3,}|~{3,})([ \t]*)([^\n`]*)$/);

  if (!match) {
    return null;
  }

  const info = match[4].trim();

  if (!/^mermaid(?:\s|$)/.test(info)) {
    return null;
  }

  return {
    indent: match[1],
    char: match[2][0],
    length: match[2].length,
    info
  };
}

function isClosingFence(line, fence) {
  const match = line.match(/^([ \t]{0,3})(`+|~+)[ \t]*$/);

  if (!match) {
    return false;
  }

  return (
    match[1] === fence.indent &&
    match[2][0] === fence.char &&
    match[2].length >= fence.length
  );
}

function normalizeDiagramSource(source) {
  return source.replace(/^\n+/, "").replace(/\n+$/, "");
}

function renderMermaidBlock(code, options) {
  const escaped = options.escapeHtml === false ? code : escapeHtml(code);

  return [
    "",
    '<div class="mermaid" data-mermaid-next="true">',
    escaped,
    "</div>",
    ""
  ].join("\n");
}

function escapeHtml(value) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function injectConfigScript(html, options) {
  if (typeof html !== "string" || html.includes("window.__honkitPluginMermaidNext")) {
    return html;
  }

  const config = {
    theme: options.theme,
    cdn: options.cdn,
    mermaidVersion: options.mermaidVersion,
    mermaidCdn: options.mermaidCdn,
    lazy: options.lazy,
    lazyMargin: options.lazyMargin,
    securityLevel: options.securityLevel,
    errorRenderer: options.errorRenderer,
    config: options.config || {}
  };

  const script = [
    "<script>",
    "window.__honkitPluginMermaidNext = " + serializeConfig(config) + ";",
    "</script>"
  ].join("\n");

  return script + "\n" + html;
}

function serializeConfig(config) {
  return JSON.stringify(config)
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/<\//g, "\\u003c/")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}
