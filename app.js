const COOKIE_STORAGE_KEY = "lokx_cookie_consent_v1";
const BIOMETRIC_STORAGE_KEY = "lokx_biometric_consent_v1";
const STALE_ANALYSIS_TRANSFER_KEY = "lokx_analysis_result_v1";

// A tela inicial nunca precisa conservar um relatório anterior.
try { sessionStorage.removeItem(STALE_ANALYSIS_TRANSFER_KEY); } catch {}

const get = (selector) => document.querySelector(selector);
const cookieBanner = get("#cookie-banner");
const cookieModal = get("#cookie-modal");
const biometricModal = get("#biometric-modal");
const infoModal = get("#info-modal");
const preferencesConsent = get("#preferences-consent");
const analyticsConsent = get("#analytics-consent");
const biometricConsent = get("#biometric-consent");
const ageConsent = get("#age-consent");
const continueScan = get("#continue-scan");
const bootScreen = get("#boot-screen");
const bootProgress = get("#boot-progress");
const bootPercent = get("#boot-percent");
const bootLog = get("#boot-log");
const toast = get("#toast");
let bootTimer;
let bootValue = 0;

function readStoredValue(key) {
  try {
    return JSON.parse(localStorage.getItem(key));
  } catch {
    return null;
  }
}

function saveCookieConsent({ preferences, analytics }) {
  const payload = {
    essential: true,
    preferences,
    analytics,
    updatedAt: new Date().toISOString(),
    version: 1,
  };

  try {
    localStorage.setItem(COOKIE_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // O site continua utilizável quando o navegador bloqueia armazenamento local.
  }
  cookieBanner.hidden = true;
}

function openCookieSettings() {
  const saved = readStoredValue(COOKIE_STORAGE_KEY);
  preferencesConsent.checked = Boolean(saved?.preferences);
  analyticsConsent.checked = Boolean(saved?.analytics);
  cookieModal.showModal();
}

function showCookieBannerIfNeeded() {
  if (!readStoredValue(COOKIE_STORAGE_KEY)) cookieBanner.hidden = false;
}

function appendBootLine(index) {
  const messages = [
    "mount_visual_archive .............. OK",
    "load_face_geometry ................ OK",
    "camera_permission ............. LOCKED",
    "biometric_storage ................ OFF",
    "privacy_layer .................... ON",
    "waiting_for_human_input()",
  ];
  const message = messages[index];
  if (!message) return;
  const line = document.createElement("p");
  line.innerHTML = `<span>${String(index + 1).padStart(3, "0")}</span>${message}`;
  bootLog.append(line);
}

function finishBoot() {
  window.clearInterval(bootTimer);
  bootValue = 100;
  bootProgress.style.width = "100%";
  bootPercent.textContent = "100";
  document.body.classList.remove("booting");
  bootScreen.classList.add("is-leaving");
  sessionStorage.setItem("lokx_boot_seen", "1");
  window.setTimeout(() => {
    bootScreen.hidden = true;
    showCookieBannerIfNeeded();
    if (window.location.hash === "#scan") {
      window.setTimeout(() => get("#start-scan").click(), 180);
    }
  }, 500);
}

function startBoot() {
  const wasSeen = sessionStorage.getItem("lokx_boot_seen");
  if (wasSeen || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    window.setTimeout(finishBoot, 450);
    return;
  }

  let lineIndex = 0;
  bootTimer = window.setInterval(() => {
    bootValue = Math.min(100, bootValue + Math.ceil(Math.random() * 8));
    bootProgress.style.width = `${bootValue}%`;
    bootPercent.textContent = String(bootValue).padStart(2, "0");

    if (bootValue >= (lineIndex + 1) * 14 && lineIndex < 6) {
      appendBootLine(lineIndex);
      lineIndex += 1;
    }
    if (bootValue >= 100) finishBoot();
  }, 145);
}

get("#skip-boot").addEventListener("click", finishBoot);
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !bootScreen.hidden) finishBoot();
});

get("#accept-cookies").addEventListener("click", () => {
  saveCookieConsent({ preferences: true, analytics: true });
});
get("#reject-cookies").addEventListener("click", () => {
  saveCookieConsent({ preferences: false, analytics: false });
});
get("#customize-cookies").addEventListener("click", openCookieSettings);
get("#open-cookie-settings").addEventListener("click", openCookieSettings);
get("#save-cookie-settings").addEventListener("click", () => {
  saveCookieConsent({
    preferences: preferencesConsent.checked,
    analytics: analyticsConsent.checked,
  });
});

const fullscreenButton = get("#toggle-fullscreen");

if (!document.fullscreenEnabled) {
  fullscreenButton.hidden = true;
} else {
  fullscreenButton.addEventListener("click", async () => {
    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await document.documentElement.requestFullscreen();
      }
    } catch {
      // Alguns navegadores bloqueiam o modo tela cheia fora de uma interação direta.
    }
  });

  document.addEventListener("fullscreenchange", () => {
    fullscreenButton.textContent = document.fullscreenElement ? "sair_tela_cheia()" : "tela_cheia()";
  });
}

function openBiometricConsent() {
  biometricConsent.checked = false;
  ageConsent.checked = false;
  continueScan.disabled = true;
  biometricModal.showModal();
}

get("#start-scan").addEventListener("click", openBiometricConsent);
get("#read-protocol").addEventListener("click", () => infoModal.showModal());
get("#open-info").addEventListener("click", () => infoModal.showModal());
get(".open-scan-from-info").addEventListener("click", () => {
  window.setTimeout(openBiometricConsent, 0);
});

function updateBiometricButton() {
  continueScan.disabled = !(biometricConsent.checked && ageConsent.checked);
}

biometricConsent.addEventListener("change", updateBiometricButton);
ageConsent.addEventListener("change", updateBiometricButton);

get("#biometric-form").addEventListener("submit", (event) => {
  if (event.submitter !== continueScan) return;
  event.preventDefault();
  if (!biometricConsent.checked || !ageConsent.checked) return;

  const payload = { granted: true, grantedAt: new Date().toISOString(), version: 1 };
  try {
    sessionStorage.setItem(BIOMETRIC_STORAGE_KEY, JSON.stringify(payload));
  } catch {
    // O token permanece somente durante a ação atual caso o armazenamento esteja bloqueado.
  }

  biometricModal.close();
  get("#runtime-output").innerHTML = `
    <p><b>[OK]</b> consent_token</p>
    <p><b>[READY]</b> camera_module <span>// escolha uma fonte</span></p>
    <p><b>[LOCAL]</b> image_storage: off</p>
  `;
  toast.hidden = false;
  window.setTimeout(() => { toast.hidden = true; }, 5200);
  window.setTimeout(() => {
    window.dispatchEvent(new CustomEvent("lokx:open-scanner"));
  }, 0);
});

function updateClock() {
  get("#clock").textContent = new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

updateClock();
window.setInterval(updateClock, 1000);
startBoot();
