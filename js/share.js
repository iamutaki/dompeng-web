/**
 * Dashboard share — media sosial (WhatsApp, Telegram, X, Facebook, LinkedIn).
 */

function getDashboardShareUrl() {
  const base = window.location.href.split("#")[0];
  const hash = window.location.hash.replace(/^#/, "");
  return hash ? `${base}#${hash}` : `${base}#ringkasan`;
}

function getActiveDashboardTabMeta() {
  const tabs = window.DOMPENG_TABS || [];
  const activeBtn = document.querySelector(".tab-btn[aria-selected='true']");
  const id = activeBtn?.dataset.tab;
  return tabs.find((t) => t.id === id) || tabs[0] || { label: "Ringkasan", hash: "ringkasan" };
}

const SHARE_BRAND_SLOGAN = "NEGARA OPEN SOURCE";
const SHARE_PROGRAM_SUBTITLE = "PENAMBANG DATA";
/** Path relatif ke origin — sama dengan og:image / twitter:image di head HTML. */
const SHARE_IMAGE_PATH = "/home.png";

function getShareImageUrl() {
  try {
    return new URL(SHARE_IMAGE_PATH, window.location.origin).href;
  } catch {
    return SHARE_IMAGE_PATH;
  }
}

function buildDashboardShareText(snapshot) {
  if (!snapshot) {
    return `DOMPENG · ${SHARE_PROGRAM_SUBTITLE} · ${SHARE_BRAND_SLOGAN} — ringkasan data orang, peta kota, dan indeks pencarian (data disamarkan).`;
  }
  const tab = getActiveDashboardTabMeta();
  const parts = [
    `DOMPENG · ${tab.label} · ${SHARE_PROGRAM_SUBTITLE}`,
    `${snapshot.persons} profil orang`,
    `${snapshot.mappedCities} kota di peta`,
    `${snapshot.indexEntries} entri indeks`,
    `Diperbarui ${snapshot.updated}`,
  ];
  return parts.join(" · ");
}

function formatShareNum(n) {
  const num = Number(n);
  return Number.isFinite(num) ? num.toLocaleString("en-US") : "—";
}

function syncSharePayload() {
  if (!window.DOMPENG_SHARE) return;
  window.DOMPENG_SHARE.url = getDashboardShareUrl();
  const snap = window.DOMPENG_SHARE._snap;
  if (snap) {
    window.DOMPENG_SHARE.text = buildDashboardShareText(snap);
  }
}

function getSharePayload() {
  syncSharePayload();
  return (
    window.DOMPENG_SHARE || {
      title: "DOMPENG — Penambang Data",
      text: buildDashboardShareText(null),
      url: getDashboardShareUrl(),
      image: getShareImageUrl(),
    }
  );
}

function refreshShareUrl() {
  syncSharePayload();
  updateSocialShareLinks();
}

function setShareSnapshotFromData(data) {
  const geo = data.geo || {};
  const indexTotal = data.indexTotal || {};
  const snap = {
    persons: formatShareNum(data.summary?.persons ?? data.intel?.graphNodes),
    mappedCities: formatShareNum(geo.mappedCities),
    indexEntries: formatShareNum(indexTotal.entries),
    updated: data.updated || "",
  };
  window.DOMPENG_SHARE = {
    title: "DOMPENG — Penambang Data",
    text: buildDashboardShareText(snap),
    url: getDashboardShareUrl(),
    image: getShareImageUrl(),
    _snap: snap,
  };
  updateSocialShareLinks();
}

function buildSocialShareUrl(platform, payload) {
  const url = payload.url;
  const text = payload.text;
  const title = payload.title;
  const waLine = `${text}\n${url}`;

  switch (platform) {
    case "whatsapp":
      return `https://wa.me/?text=${encodeURIComponent(waLine)}`;
    case "telegram":
      return `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`;
    case "x":
      return `https://twitter.com/intent/tweet?text=${encodeURIComponent(text)}&url=${encodeURIComponent(url)}`;
    case "facebook":
      return `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}&quote=${encodeURIComponent(text)}`;
    case "linkedin":
      return `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(url)}`;
    default:
      return url;
  }
}

function updateSocialShareLinks() {
  const menu = document.getElementById("share-menu");
  if (!menu) return;
  const payload = getSharePayload();
  for (const link of menu.querySelectorAll(".share-menu__platform[data-share]")) {
    link.href = buildSocialShareUrl(link.dataset.share, payload);
    link.setAttribute("aria-label", `Bagikan ke ${link.textContent.trim()}`);
  }
}

function openSocialShare(platform) {
  const href = buildSocialShareUrl(platform, getSharePayload());
  if (!href) return;
  const w = 640;
  const h = 520;
  const left = Math.max(0, Math.round((window.screen.width - w) / 2));
  const top = Math.max(0, Math.round((window.screen.height - h) / 2));
  window.open(
    href,
    "_blank",
    `noopener,noreferrer,width=${w},height=${h},left=${left},top=${top}`,
  );
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  const area = document.createElement("textarea");
  area.value = text;
  area.setAttribute("readonly", "");
  area.style.position = "fixed";
  area.style.left = "-9999px";
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch {
    ok = false;
  }
  area.remove();
  return ok;
}

function flashShareFeedback(button, message) {
  if (!button) return;
  const prev = button.dataset.defaultLabel || button.textContent;
  if (!button.dataset.defaultLabel) button.dataset.defaultLabel = prev;
  button.textContent = message;
  button.disabled = true;
  window.setTimeout(() => {
    button.textContent = button.dataset.defaultLabel || prev;
    button.disabled = false;
  }, 1600);
}

function closeShareMenu(menu, trigger) {
  if (!menu) return;
  menu.hidden = true;
  if (trigger) trigger.setAttribute("aria-expanded", "false");
}

function openShareMenu(menu, trigger) {
  if (!menu) return;
  updateSocialShareLinks();
  menu.hidden = false;
  if (trigger) trigger.setAttribute("aria-expanded", "true");
}

function toggleShareMenu(menu, trigger) {
  if (!menu) return;
  if (menu.hidden) openShareMenu(menu, trigger);
  else closeShareMenu(menu, trigger);
}

async function runNativeShare(trigger) {
  const payload = getSharePayload();
  if (!navigator.share) return false;
  try {
    await navigator.share({
      title: payload.title,
      text: payload.text,
      url: payload.url,
    });
    return true;
  } catch (err) {
    if (err?.name === "AbortError") return true;
    return false;
  }
}

function initDashboardShare() {
  const trigger = document.getElementById("share-btn");
  const menu = document.getElementById("share-menu");
  if (!trigger || !menu) return;

  const canNativeShare = typeof navigator.share === "function";
  const nativeItem = menu.querySelector('[data-share="native"]');
  if (nativeItem) nativeItem.hidden = !canNativeShare;

  trigger.addEventListener("click", (event) => {
    event.stopPropagation();
    toggleShareMenu(menu, trigger);
  });

  menu.addEventListener("click", async (event) => {
    const social = event.target.closest(".share-menu__platform[data-share]");
    if (social) {
      event.preventDefault();
      openSocialShare(social.dataset.share);
      closeShareMenu(menu, trigger);
      return;
    }

    const item = event.target.closest("[data-share]");
    if (!item) return;
    const action = item.dataset.share;

    if (action === "native") {
      await runNativeShare(trigger);
    } else if (action === "copy-link") {
      const ok = await copyText(getSharePayload().url);
      flashShareFeedback(trigger, ok ? "Tautan disalin" : "Gagal");
    }
    closeShareMenu(menu, trigger);
  });

  document.addEventListener("click", (event) => {
    if (event.target.closest("#share-control")) return;
    closeShareMenu(menu, trigger);
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeShareMenu(menu, trigger);
  });
}

document.addEventListener("DOMContentLoaded", initDashboardShare);

window.setShareSnapshotFromData = setShareSnapshotFromData;
window.refreshShareUrl = refreshShareUrl;
window.getDashboardShareUrl = getDashboardShareUrl;
