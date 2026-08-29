const PATHS = {
  now: `<circle cx="12" cy="12" r="3.2"/><circle cx="12" cy="12" r="7.5" opacity=".45"/>`,
  soon: `<circle cx="12" cy="12" r="8"/><path d="M12 8v4.2l2.6 1.6"/>`,
  info: `<circle cx="12" cy="12" r="8"/><path d="M12 11v5M12 8h.01"/>`,
  target: `<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>`,
  price: `<path d="M7 7.5h7.5a3 3 0 0 1 0 6H9m0 0h6.2a3 3 0 0 1 0 6H7M12 4v16"/>`,
  repo: `<path d="M8 5h10v14H8z"/><path d="M8 5H6a1 1 0 0 0-1 1v12"/><path d="M11 9h4M11 13h4"/>`,
  mail: `<path d="M4 7h16v10H4z"/><path d="m4 7 8 6 8-6"/>`,
  down: `<path d="M12 5v14M6 13l6 6 6-6"/>`,
  up: `<path d="M12 19V5M6 11l6-6 6 6"/>`,
  tag: `<path d="M4 12V5h7l8 8-7 7z"/><circle cx="8" cy="8" r="1.1" fill="currentColor" stroke="none"/>`,
};

export function icon(name) {
  const inner = PATHS[name] || PATHS.info;
  return `<svg class="ico" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</svg>`;
}
