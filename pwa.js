let deferredInstallPrompt = null;

const installButton = document.querySelector("#install-app");
const isStandalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent);

function notifyInstall(message) {
  const toast = document.querySelector("#toast") || document.querySelector("#pwa-toast");
  if (toast) {
    toast.innerHTML = `<b>[PWA]</b> ${message}`;
    toast.hidden = false;
    window.setTimeout(() => { toast.hidden = true; }, 7000);
  } else {
    window.alert(message);
  }
}

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").catch((error) => {
      console.warn("LOKX service worker não registrado:", error);
    });
  });
}

window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  if (installButton) installButton.hidden = false;
});

if (installButton) {
  if (isStandalone) {
    installButton.hidden = true;
    document.documentElement.classList.add("is-standalone");
  } else if (isIOS) {
    installButton.hidden = false;
    installButton.textContent = "instalar_no_ios()";
  }

  installButton.addEventListener("click", async () => {
    if (isIOS && !deferredInstallPrompt) {
      notifyInstall("No Safari, toque em Compartilhar e depois em Adicionar à Tela de Início.");
      return;
    }
    if (!deferredInstallPrompt) {
      notifyInstall("A instalação aparece quando o site está publicado em HTTPS e cumpre os requisitos do navegador.");
      return;
    }
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    installButton.hidden = true;
  });
}

window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  if (installButton) installButton.hidden = true;
  notifyInstall("LOKX instalado como aplicativo.");
});
